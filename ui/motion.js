    function motionAllowed() {
      return typeof matchMedia !== 'function' || !matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    const reorderBindings = new Map();
    let reorderDrag = null;

    function reorderShouldInsertBefore(clientY, top, height) {
      return Number(clientY) < Number(top) + Number(height) / 2;
    }

    function reorderIdList(ids, fromIndex, overIndex, insertBefore) {
      const list = (ids || []).slice();
      fromIndex = Number(fromIndex);
      overIndex = Number(overIndex);
      if (fromIndex < 0 || overIndex < 0 || fromIndex >= list.length || overIndex >= list.length || fromIndex === overIndex) return list;
      const item = list[fromIndex];
      list.splice(fromIndex, 1);
      let dest = overIndex;
      if (fromIndex < overIndex) dest -= 1;
      if (!insertBefore) dest += 1;
      if (dest < 0) dest = 0;
      if (dest > list.length) dest = list.length;
      list.splice(dest, 0, item);
      return list;
    }

    function reorderRowElements(parent, selector) {
      if (!parent || !parent.querySelectorAll) return [];
      return Array.prototype.slice.call(parent.querySelectorAll(selector));
    }

    function reorderRowKeys(rows, keyOf) {
      return (rows || []).map(function(row) { return keyOf(row); });
    }

    function reorderBlock(row, blockFor) {
      return blockFor ? blockFor(row) : [row];
    }

    function reorderTops(elements) {
      const tops = new Map();
      (elements || []).forEach(function(element) {
        if (!element || !element.getBoundingClientRect) return;
        tops.set(element, element.getBoundingClientRect().top);
      });
      return tops;
    }

    function reorderAnimatedElements(parent, selector, blockFor) {
      const rows = reorderRowElements(parent, selector);
      const animated = rows.slice();
      if (!blockFor) return animated;
      rows.forEach(function(row) {
        reorderBlock(row, blockFor).forEach(function(node) {
          if (node !== row) animated.push(node);
        });
      });
      return animated;
    }

    const REORDER_MOVE_SECONDS = .16;

    function reorderOffsetY(element) {
      const gsap = window.uiLibraries && window.uiLibraries.gsap;
      if (!gsap || !element) return 0;
      const value = parseFloat(gsap.getProperty(element, 'y'));
      return value || 0;
    }

    function reorderMeasuredNodes(row, blockFor) {
      const nodes = reorderBlock(row, blockFor).filter(function(node) {
        if (!node || !node.getBoundingClientRect) return false;
        const rect = node.getBoundingClientRect();
        return rect.height > 0 || rect.width > 0;
      });
      return nodes.length ? nodes : reorderBlock(row, blockFor).slice(0, 1);
    }

    function reorderLayoutSpan(row, blockFor) {
      const nodes = reorderMeasuredNodes(row, blockFor);
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !first.getBoundingClientRect) return null;
      const firstRect = first.getBoundingClientRect();
      const lastRect = last.getBoundingClientRect();
      return {
        top: firstRect.top - reorderOffsetY(first),
        bottom: lastRect.bottom - reorderOffsetY(last)
      };
    }

    function reorderVisualCenter(row, blockFor) {
      const nodes = reorderMeasuredNodes(row, blockFor);
      const first = nodes[0] && nodes[0].getBoundingClientRect ? nodes[0].getBoundingClientRect() : null;
      const last = nodes[nodes.length - 1] && nodes[nodes.length - 1].getBoundingClientRect ? nodes[nodes.length - 1].getBoundingClientRect() : null;
      if (!first || !last) return 0;
      return (first.top + last.bottom) / 2;
    }

    function reorderTargetIndex(rows, dragged, blockFor) {
      const center = reorderVisualCenter(dragged, blockFor);
      let index = 0;
      (rows || []).forEach(function(row) {
        if (row === dragged) return;
        const span = reorderLayoutSpan(row, blockFor);
        if (!span) return;
        if (center > (span.top + span.bottom) / 2) index += 1;
      });
      return index;
    }

    function reorderStickyName(element) {
      if (!element || !element.querySelector) return null;
      const name = element.querySelector('.span-name');
      return name && name !== element ? name : null;
    }

    function pinReorderSticky(element) {
      const name = reorderStickyName(element);
      const scroller = element && element.closest && element.closest('.week-calendar-scroll');
      if (!name || !scroller) return;
      // つかんでいる行は、名前の欄が横スクロールに追従して見える位置にいるはず。
      // ブラウザによっては、動かしている間は貼り付き（sticky）が効かないので、実際の位置を測って、ずれている分だけ戻す。
      name.style.transform = '';
      if (!scroller.scrollLeft) return;
      const delta = scroller.getBoundingClientRect().left - name.getBoundingClientRect().left;
      if (Math.abs(delta) > 1) name.style.transform = 'translateX(' + delta + 'px)';
    }

    function unpinReorderSticky(element) {
      const name = reorderStickyName(element);
      if (name) name.style.transform = '';
    }

    function settleReorderElement(element) {
      const gsap = window.uiLibraries && window.uiLibraries.gsap;
      if (!element || !gsap || Math.abs(reorderOffsetY(element)) > 0.5) return;
      gsap.set(element, { clearProps: 'transform' });
      unpinReorderSticky(element);
    }

    function animateReorder(elements, firstTops, dragged, blockFor) {
      if (!elements || !firstTops || !motionAllowed()) return 0;
      const gsap = window.uiLibraries && window.uiLibraries.gsap;
      if (!gsap) return 0;
      const skipped = new Set(dragged ? reorderBlock(dragged, blockFor) : []);
      let moved = false;
      elements.forEach(function(element) {
        if (!element || skipped.has(element) || !element.getBoundingClientRect) return;
        const first = firstTops.get(element);
        if (first == null) return;
        const layoutTop = element.getBoundingClientRect().top - reorderOffsetY(element);
        const dy = first - layoutTop;
        if (Math.abs(dy) < 1) {
          settleReorderElement(element);
          return;
        }
        pinReorderSticky(element);
        gsap.fromTo(element, { y: dy }, {
          y: 0,
          duration: REORDER_MOVE_SECONDS,
          ease: 'power3.out',
          overwrite: true,
          onComplete: function() { settleReorderElement(element); }
        });
        moved = true;
      });
      return moved ? REORDER_MOVE_SECONDS : 0;
    }

    function positionDraggedBlock(row, clientY, grabOffset, blockFor) {
      const gsap = window.uiLibraries.gsap;
      const currentY = parseFloat(gsap.getProperty(row, 'y')) || 0;
      const layoutTop = row.getBoundingClientRect().top - currentY;
      const y = clientY - grabOffset - layoutTop;
      reorderBlock(row, blockFor).forEach(function(node) {
        gsap.set(node, { y: y });
        pinReorderSticky(node);
      });
    }

    function applyReorder(parent, ids, rows, keyOf, blockFor) {
      if (!parent || !ids || !ids.length) return false;
      if (reorderRowKeys(rows, keyOf).join('\0') === ids.join('\0')) return false;
      const byKey = {};
      rows.forEach(function(row) { byKey[keyOf(row)] = row; });
      const marker = document.createComment('reorder');
      parent.appendChild(marker);
      ids.forEach(function(id) {
        const row = byKey[id];
        if (!row) return;
        reorderBlock(row, blockFor).forEach(function(node) {
          parent.insertBefore(node, marker);
        });
      });
      parent.removeChild(marker);
      return true;
    }

    function liveReorderElements(parent, dragged, clientY, session, options) {
      if (!parent || !dragged || !options) return false;
      const rows = reorderRowElements(parent, options.selector);
      const fromIndex = rows.indexOf(dragged);
      if (fromIndex < 0) return false;
      const targetIndex = reorderTargetIndex(rows, dragged, options.blockFor);
      if (targetIndex === fromIndex) return false;
      const ids = reorderRowKeys(rows, options.keyOf);
      const next = ids.slice();
      next.splice(targetIndex, 0, next.splice(fromIndex, 1)[0]);
      const animated = reorderAnimatedElements(parent, options.selector, options.blockFor);
      const firstTops = reorderTops(animated);
      applyReorder(parent, next, rows, options.keyOf, options.blockFor);
      positionDraggedBlock(dragged, clientY, session.grabOffset, options.blockFor);
      animateReorder(animated, firstTops, dragged, options.blockFor);
      return true;
    }

    function setReorderDragging(row, blockFor, dragging) {
      reorderBlock(row, blockFor).forEach(function(node) {
        if (node && node.classList) node.classList.toggle('is-dragging', !!dragging);
      });
    }

    function releaseReorderBinding(key) {
      const binding = reorderBindings.get(key);
      if (!binding) return;
      binding.instances.forEach(function(instance) {
        instance.kill();
        if (instance._rowProxy) instance._rowProxy.remove();
      });
      reorderBindings.delete(key);
    }

    function ensureReorderScroll() {
      if (ensureReorderScroll.bound) return;
      ensureReorderScroll.bound = true;
      window.addEventListener('scroll', function() {
        if (reorderDrag) reorderDrag.move(reorderDrag.clientY);
      }, true);
    }

    function bindReorderDraggables(parent, options) {
      const key = options.bindKey || parent;
      if (!parent || !window.uiLibraries || !window.uiLibraries.Draggable) { releaseReorderBinding(key); return; }
      let binding = reorderBindings.get(key);
      if (binding && binding.parent !== parent) { releaseReorderBinding(key); binding = null; }
      binding = binding || { parent: parent, instances: [] };
      binding.options = options;
      const previous = new Map(binding.instances.map(function(instance) { return [instance._rowElement, instance]; }));
      const Draggable = window.uiLibraries.Draggable;
      const gsap = window.uiLibraries.gsap;
      const instances = [];
      Array.prototype.forEach.call(parent.querySelectorAll(binding.options.selector), function(row) {
        if (binding.options.canDrag && !binding.options.canDrag(row)) return;
        const handle = row.querySelector(binding.options.handleSelector);
        if (!handle) return;
        const existing = previous.get(row);
        if (existing && existing._rowHandle === handle) {
          instances.push(existing);
          previous.delete(row);
          return;
        }
        const proxy = document.createElement('div');
        proxy.style.cssText = 'position:fixed;top:-100px;left:-100px;width:1px;height:1px;opacity:0;pointer-events:none';
        document.body.appendChild(proxy);
        const session = { lastDirection: 0, lastSwapY: 0, grabOffset: 0, clientY: 0, startOrder: '' };
        function move(clientY) {
          session.clientY = clientY;
          if (reorderDrag && reorderDrag.move === move) reorderDrag.clientY = clientY;
          positionDraggedBlock(row, clientY, session.grabOffset, binding.options.blockFor);
          liveReorderElements(parent, row, clientY, session, binding.options);
        }
        const instance = Draggable.create(proxy, {
          trigger: handle,
          type: 'y',
          dragClickables: true,
          autoScroll: 1,
          onPress: function() {
            session.lastDirection = 0;
            session.lastSwapY = 0;
            session.startOrder = reorderRowKeys(reorderRowElements(parent, binding.options.selector), binding.options.keyOf).join('\n');
            reorderBlock(row, binding.options.blockFor).forEach(function(node) {
              gsap.killTweensOf(node);
              gsap.set(node, { clearProps: 'transform' });
              unpinReorderSticky(node);
            });
            session.clientY = this.pointerEvent ? this.pointerEvent.clientY : this.pointerY - window.scrollY;
            session.grabOffset = session.clientY - row.getBoundingClientRect().top;
            setReorderDragging(row, binding.options.blockFor, true);
            parent.classList.add('is-reordering');
            reorderDrag = { move: move, clientY: session.clientY, instance: instance, cancel: false };
            if (binding.options.onPress) binding.options.onPress(row, session);
          },
          onDrag: function() {
            move(this.pointerEvent ? this.pointerEvent.clientY : this.pointerY - window.scrollY);
          },
          onRelease: function() {
            const cancel = !!(reorderDrag && reorderDrag.move === move && reorderDrag.cancel);
            if (reorderDrag && reorderDrag.move === move) reorderDrag = null;
            const animated = reorderAnimatedElements(parent, binding.options.selector, binding.options.blockFor);
            const tops = reorderTops(animated);
            const duration = animateReorder(animated, tops, null, binding.options.blockFor);
            parent.classList.remove('is-reordering');
            if (duration && window.uiLibraries && window.uiLibraries.gsap) {
              window.uiLibraries.gsap.delayedCall(duration, function() {
                setReorderDragging(row, binding.options.blockFor, false);
              });
            } else {
              setReorderDragging(row, binding.options.blockFor, false);
            }
            if (cancel) {
              if (binding.options.onCancel) binding.options.onCancel(parent, row);
              return;
            }
            const changed = session.startOrder !== reorderRowKeys(reorderRowElements(parent, binding.options.selector), binding.options.keyOf).join('\n');
            if (binding.options.onFinish) binding.options.onFinish(parent, changed, row);
          }
        })[0];
        instance._rowProxy = proxy;
        instance._rowElement = row;
        instance._rowHandle = handle;
        instances.push(instance);
      });
      previous.forEach(function(instance) {
        instance.kill();
        if (instance._rowProxy) instance._rowProxy.remove();
      });
      binding.instances = instances;
      reorderBindings.set(key, binding);
      ensureReorderScroll();
    }

    function cancelActiveReorder() {
      if (!reorderDrag || !reorderDrag.instance) return;
      reorderDrag.cancel = true;
      if (reorderDrag.instance.endDrag) reorderDrag.instance.endDrag();
    }


    // 行の高さが変わるとき（カレンダー予定の件数が変わる、予定の行が増減するなど）に、ぱっと変わらず、なめらかに動かす。
    // 描き直す直前に高さを控え（captureRowHeights）、描き直した後に、変わった行だけ高さを元の値から動かす（animateRowHeights）。
    function captureRowHeights(root, selector, keyOf) {
      const heights = new Map();
      if (!root || !motionAllowed()) return heights;
      root.querySelectorAll(selector).forEach(function(row) {
        const key = keyOf(row);
        if (key) heights.set(key, row.getBoundingClientRect().height);
      });
      return heights;
    }
    function animateRowHeights(root, selector, keyOf, before) {
      if (!root || !before || !before.size || !motionAllowed()) return;
      // 先に全部の高さをまとめて測り、そのあとでアニメーションを作る（測りながら作ると、そのたびにレイアウトの再計算が走って重い）。
      const rows = Array.from(root.querySelectorAll(selector));
      const changes = [];
      rows.forEach(function(row) {
        const key = keyOf(row);
        const from = key ? before.get(key) : null;
        if (from == null) return;
        const to = row.getBoundingClientRect().height;
        if (Math.abs(to - from) >= 2) changes.push({ row: row, from: from, to: to });
      });
      changes.forEach(function(change) {
        if (!change.row.animate) return;
        change.row.animate([{ height: change.from + 'px' }, { height: change.to + 'px' }], { duration: 220, easing: 'cubic-bezier(.2, 0, 0, 1)' });
      });
    }

    // スクロールバーの見た目を、Materialの部品の内側（メニュー、選択リスト、複数行の入力欄、ダイアログ）にも当てる。
    // 部品の内側は、外側のCSSが届かないため、部品ごとに同じ内容のスタイルを足す。色は外側の変数（--scrollbar-thumb）を引き継ぐ。
    const SCROLLBAR_SHADOW_CSS = [
      '*::-webkit-scrollbar { width: 12px; height: 12px; }',
      '*::-webkit-scrollbar-track { background: transparent; }',
      '*::-webkit-scrollbar-thumb { min-height: 36px; border: 3px solid transparent; border-radius: 999px; background: var(--scrollbar-thumb, rgba(95, 99, 104, .38)); background-clip: padding-box; }',
      '*::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-thumb-hover, rgba(95, 99, 104, .62)); background-clip: padding-box; }',
      '*::-webkit-scrollbar-corner { background: transparent; }',
      '@supports not selector(::-webkit-scrollbar) { * { scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb, rgba(95, 99, 104, .38)) transparent; } }'
    ].join('\n');
    let scrollbarShadowSheet = null;
    const scrollbarShadowDone = typeof WeakSet === 'function' ? new WeakSet() : null;
    function adoptScrollbarStyle(root) {
      if (!root || !root.querySelectorAll || typeof CSSStyleSheet !== 'function') return;
      if (!scrollbarShadowSheet) {
        try { scrollbarShadowSheet = new CSSStyleSheet(); scrollbarShadowSheet.replaceSync(SCROLLBAR_SHADOW_CSS); }
        catch (_) { scrollbarShadowSheet = false; }
      }
      if (!scrollbarShadowSheet) return;
      root.querySelectorAll('md-menu, md-dialog, md-outlined-select, md-outlined-text-field, md-filled-text-field, md-select, md-list').forEach(function(host) {
        const shadow = host.shadowRoot;
        if (!shadow || (scrollbarShadowDone && scrollbarShadowDone.has(shadow))) {
          if (shadow) adoptScrollbarStyle(shadow);
          return;
        }
        if (scrollbarShadowDone) scrollbarShadowDone.add(shadow);
        try { shadow.adoptedStyleSheets = shadow.adoptedStyleSheets.concat([scrollbarShadowSheet]); } catch (_) {}
        adoptScrollbarStyle(shadow);
      });
    }
    function installMaterialScrollbars() {
      const run = function() { adoptScrollbarStyle(document); };
      run();
      // 部品が後から作られる・開かれるので、操作のたびに、まだ当てていない部品へ当てる（当て済みは飛ばす）。
      ['pointerdown', 'focusin'].forEach(function(type) { document.addEventListener(type, run, true); });
      if (window.customElements && customElements.whenDefined) customElements.whenDefined('md-menu').then(run);
    }
    // ホバーで出る説明（title）は、ブラウザ標準の吹き出しではなく、Material の plain tooltip で出す。
    // どの画面でも標準の吹き出しが出ないよう、title が付いた瞬間（あとから描かれた要素も、付け直されたときも）に
    // data-hint へ移して title を消す。標準の吹き出しの元がなくなるので、場所ごとの対処は要らない。
    function installMaterialTooltips() {
      const HINT = 'data-hint';
      let tip = null;
      let owner = null;
      let timer = 0;
      const convert = function(el) {
        if (!el || el.nodeType !== 1 || !el.hasAttribute('title')) return;
        const value = String(el.getAttribute('title') || '').trim();
        el.removeAttribute('title');
        if (!value) { el.removeAttribute(HINT); return; }
        el.setAttribute(HINT, value);
        // 文字のないボタンは、title が読み上げの名前の代わりだったので、aria-label に引き継ぐ。
        if (!el.hasAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', value);
      };
      // 文字のないアイコンボタンは、title を付け忘れても、aria-label を説明として出す（どのボタンでもヒントが出るように）。
      const ensureHint = function(el) {
        if (!el || el.nodeType !== 1 || el.hasAttribute(HINT) || el.hasAttribute('title')) return;
        const label = el.getAttribute('aria-label') || el.getAttribute('data-aria-label');
        if (label && String(label).trim()) el.setAttribute(HINT, String(label).trim());
      };
      const convertTree = function(root) {
        if (!root || root.nodeType !== 1) return;
        convert(root);
        root.querySelectorAll('[title]').forEach(convert);
        if (root.matches && root.matches('md-icon-button, md-checkbox')) ensureHint(root);
        root.querySelectorAll('md-icon-button, md-checkbox').forEach(ensureHint);
      };
      convertTree(document.documentElement);
      new MutationObserver(function(records) {
        records.forEach(function(record) {
          if (record.type === 'attributes') convert(record.target);
          else record.addedNodes.forEach(convertTree);
        });
      }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
      const hide = function() {
        clearTimeout(timer);
        if (tip) tip.classList.remove('is-visible');
      };
      const show = function(el, text) {
        if (!tip) {
          tip = document.createElement('div');
          tip.className = 'material-tooltip';
          tip.setAttribute('role', 'tooltip');
          document.body.appendChild(tip);
        }
        tip.textContent = text;
        const rect = el.getBoundingClientRect();
        tip.style.left = '0px'; tip.style.top = '0px';
        const width = tip.offsetWidth, height = tip.offsetHeight;
        const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
        const below = rect.bottom + 6 + height <= window.innerHeight - 4;
        tip.style.left = left + 'px';
        tip.style.top = (below ? rect.bottom + 6 : Math.max(4, rect.top - height - 6)) + 'px';
        tip.classList.add('is-visible');
      };
      const enter = function(event) {
        const el = event.target && event.target.closest ? event.target.closest('[' + HINT + ']') : null;
        if (el === owner && el) return;
        hide();
        owner = el;
        if (!el) return;
        timer = setTimeout(function() {
          const text = el.getAttribute(HINT);
          const monthHint = document.getElementById('monthOpenHint');
          // 月タブの「開く先」の説明が出ているときは、重ならないよう出さない。
          if (owner === el && el.isConnected && text && !(monthHint && !monthHint.hidden)) show(el, text);
        }, 400);
      };
      // 無効なボタンではマウスのイベントが来ないことがあるので、ポインターのイベントも使う。
      ['mouseover', 'pointerover'].forEach(function(type) { document.addEventListener(type, enter, true); });
      document.addEventListener('mouseout', function(event) {
        if (owner && !owner.contains(event.relatedTarget)) { hide(); owner = null; }
      }, true);
      ['pointerdown', 'keydown', 'scroll'].forEach(function(type) { document.addEventListener(type, hide, true); });
    }
