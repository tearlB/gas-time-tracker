    function escapeHtml(value) {
      return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // 備考にあるURL（重複を除いて先頭から）。編集パネルにリンクとして出す。
    function planNoteLinks(note, limit) {
      const found = [];
      (String(note == null ? '' : note).match(/https?:\/\/[\x21-\x7e]+/g) || []).forEach(function(raw) {
        const url = raw.replace(/[.,;:!?)\]}<>"']+$/, '');
        if (url && found.indexOf(url) < 0) found.push(url);
      });
      return found.slice(0, limit || 3);
    }
    // 一覧の予定行の名前の横に出す備考のアイコン。備考があるときは常に、ないときは行にカーソルを乗せたときだけ見える。
    // 押すとその場の入力パネルで編集する。行の高さは変えない。
    function planNoteIconHtml(planId, note, editable) {
      const text = String(note == null ? '' : note).trim();
      if (!planId || !editable) return '';
      const tip = text ? (text.length > 300 ? text.slice(0, 300) + '…' : text) : '備考を追加';
      return '<button type="button" class="plan-note-icon' + (text ? '' : ' is-empty') + '" data-plan-note-id="' + escapeHtml(planId) + '" title="' + escapeHtml(tip) + '" aria-label="' + (text ? '備考を開く' : '備考を追加') + '">' +
        '<span class="material-symbols-outlined" aria-hidden="true">sticky_note_2</span></button>';
    }

    // actionHtml は呼び出し側が作る固定のボタンなど（文字は含めない）。文章の下の中央に置く。
    function emptyStateHtml(title, description, actionHtml) {
      return '<div class="empty-state"><strong>' + escapeHtml(title) + '</strong>' +
        (description ? '<small>' + escapeHtml(description) + '</small>' : '') +
        (actionHtml ? '<div class="empty-state-action">' + actionHtml + '</div>' : '') + '</div>';
    }

    function projectMetricHtml(label, value, unit, extraClass) {
      return '<div class="project-metric' + (extraClass ? ' ' + escapeHtml(extraClass) : '') + '">' +
        '<span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) +
        '<small>' + escapeHtml(unit) + '</small></strong></div>';
    }

    // Backlog の課題ページ URL（https://<space>.backlog.jp/view/KEY-123）から課題キーを取り出す。
    const BACKLOG_ISSUE_URL_PATTERN = /https:\/\/[a-z0-9-]+\.(?:backlog\.(?:jp|com)|backlogtool\.com)\/view\/([A-Za-z0-9_]+-\d+)(?:[?#][^\s"'<>]*)?/;
    function backlogIssueKeyFromUrl(url) {
      const match = String(url || '').trim().match(new RegExp('^' + BACKLOG_ISSUE_URL_PATTERN.source + '$'));
      return match ? match[1].toUpperCase() : '';
    }
    // 課題URLを持ち、名前が課題キーで始まる予定だけを Backlog 課題として扱う。
    function planBacklogIssue(name, issueUrl) {
      const key = backlogIssueKeyFromUrl(issueUrl);
      const text = String(name || '').trim();
      if (!key || text.toUpperCase().indexOf(key) !== 0) return null;
      const rest = text.slice(key.length);
      if (rest && !/^\s/.test(rest)) return null;
      return { key: text.slice(0, key.length), url: String(issueUrl).trim(), description: rest.trim() };
    }
    // Backlog からのコピーは、貼り付け先によって課題キーが URL のリンクになる。
    // HTML のリンク先か、テキスト中の URL から課題キーと課題URLを取り出す。
    function backlogIssueFromClipboard(html, text) {
      const plain = String(text || '').replace(/\s+/g, ' ').trim();
      let url = '';
      if (html && typeof DOMParser !== 'undefined') {
        const doc = new DOMParser().parseFromString(String(html), 'text/html');
        const link = Array.prototype.find.call(doc.querySelectorAll('a[href]'), function(anchor) {
          return !!backlogIssueKeyFromUrl(anchor.getAttribute('href'));
        });
        if (link) url = link.getAttribute('href').trim();
      }
      if (!url) {
        const match = plain.match(BACKLOG_ISSUE_URL_PATTERN);
        if (match) url = match[0];
      }
      const key = backlogIssueKeyFromUrl(url);
      if (!key) return null;
      const rest = plain.split(url).join(' ').replace(new RegExp('(^|\\s)' + key + '(?=\\s|$)', 'gi'), ' ').replace(/\s+/g, ' ').trim();
      return { name: rest ? key + ' ' + rest : key, url: url };
    }
    // lead を渡すと（週の予定の行）、Backlog 課題の課題キーの段と同じ位置に、通常の課題はその文字（プロジェクト名など）を薄く出す。
    // 課題キーの有無にかかわらず、先頭セルの高さと配置をそろえるため。
    function planSummaryTitleHtml(name, issueUrl, lead) {
      const text = String(name || '');
      const issue = planBacklogIssue(text, issueUrl);
      const leadHtml = lead ? '<span class="span-name-lead">' + escapeHtml(lead) + '</span>' : '';
      if (!issue && lead != null) {
        return '<b class="has-issue-key is-plain" title="' + escapeHtml(text) + '">' +
          '<span class="span-name-top">' + leadHtml + '</span>' +
          '<span class="span-name-description">' + escapeHtml(text) + '</span></b>';
      }
      if (!issue) return '<b title="' + escapeHtml(text) + '">' + escapeHtml(text) + '</b>';
      const keyLink = '<a class="span-name-key" href="' + escapeHtml(issue.url) + '" target="_blank" rel="noopener noreferrer" title="Backlogで開く">' + escapeHtml(issue.key) +
        '<span class="material-symbols-outlined" aria-hidden="true">open_in_new</span></a>';
      // 週の予定の行では、1段目にプロジェクト名を先に、そのあとに課題キーを出す。
      if (lead != null) {
        return '<b class="has-issue-key" title="' + escapeHtml(text) + '">' +
          '<span class="span-name-top">' + leadHtml + (leadHtml ? '<span class="span-name-sep" aria-hidden="true">·</span>' : '') + keyLink + '</span>' +
          '<span class="span-name-description">' + escapeHtml(issue.description || issue.key) + '</span></b>';
      }
      return '<b class="has-issue-key" title="' + escapeHtml(text) + '">' + keyLink +
        '<span class="span-name-description">' + escapeHtml(issue.description || issue.key) + '</span></b>';
    }

    // Shared markup is used by both the page build and dynamic screen rendering.
    function uiAttributesHtml(attributes) {
      return Object.keys(attributes || {}).map(function(name) {
        if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('Invalid UI attribute: ' + name);
        const value = attributes[name];
        if (value == null || value === false) return '';
        return value === true ? ' ' + name : ' ' + name + '="' + escapeHtml(value) + '"';
      }).join('');
    }
    function iconButtonHtml(icon, attributes) {
      return '<md-icon-button' + uiAttributesHtml(Object.assign({ 'touch-target': 'wrapper' }, attributes)) +
        '><span class="material-symbols-outlined" aria-hidden="true">' + escapeHtml(icon) + '</span></md-icon-button>';
    }
    function dialogHeadlineHtml(options) {
      const title = '<span class="dialog-title" id="' + escapeHtml(options.titleId) + '">' + escapeHtml(options.title) + '</span>';
      const copy = options.eyebrow
        ? '<div class="' + escapeHtml(options.copyClass || 'dialog-headline-copy') + '"><span class="' + escapeHtml(options.eyebrowClass || 'dialog-eyebrow') + '">' + escapeHtml(options.eyebrow) + '</span>' + title + '</div>'
        : title;
      return '<div slot="headline" class="dialog-headline' + (options.className ? ' ' + escapeHtml(options.className) : '') + '">' + copy +
        iconButtonHtml('close', { class: 'dialog-close', id: options.closeId, 'aria-label': '閉じる' }) + '</div>';
    }
    function summaryCardHtml(options) {
      const metric = options.kind === 'metric';
      const prefix = metric ? 'metric' : 'summary';
      const value = options.valueId && !options.valueOnContainer
        ? '<span id="' + escapeHtml(options.valueId) + '">' + escapeHtml(options.value) + '</span>' : escapeHtml(options.value);
      return '<article' + uiAttributesHtml({ class: (metric ? 'metric' : 'summary-card') + (options.className ? ' ' + options.className : ''), id: options.id }) + '>' +
        '<span class="' + prefix + '-label">' + escapeHtml(options.label) + '</span>' +
        '<span' + uiAttributesHtml({ class: prefix + '-value', id: options.valueOnContainer ? options.valueId : null }) + '>' + value +
        (options.unit ? '<small>' + escapeHtml(options.unit) + '</small>' : '') + '</span>' +
        '<span' + uiAttributesHtml({ class: prefix + '-meta', id: options.metaId }) + '>' + escapeHtml(options.meta) + '</span></article>';
    }
    // 機能の横に置く小さな説明（ⓘ）。押す・マウスを乗せる・フォーカスで吹き出しを出す（bootstrap.js）。
    function tipHtml(options) {
      const text = String(options.text || '');
      return '<button type="button" class="ui-tip" data-tip="' + escapeHtml(text) + '" aria-label="' + escapeHtml('説明: ' + text) + '">' +
        '<span class="material-symbols-outlined" aria-hidden="true">info</span></button>';
    }
    function choiceGroupHtml(options) {
      return '<div' + uiAttributesHtml({ class: 'ui-choice-group' + (options.className ? ' ' + options.className : ''), id: options.id, role: 'group', 'aria-label': options.label }) + '>' +
        options.items.map(function(item) {
          const selected = item.value === options.selected;
          return '<md-filter-chip' + uiAttributesHtml(Object.assign({}, item.attributes, {
            class: 'ui-choice' + (selected ? ' is-active' : ''), label: item.label, selected: selected
          })) + '></md-filter-chip>';
        }).join('') + '</div>';
    }
    function setUiChoice(button, selected) {
      button.classList.toggle('is-active', !!selected);
      button.selected = !!selected;
    }
    function navigationItemHtml(options) {
      return '<md-filled-tonal-button' + uiAttributesHtml(Object.assign({}, options.attributes, {
        class: 'ui-navigation-item' + (options.selected ? ' is-active' : ''), type: 'button', 'aria-label': options.label + (options.selected ? '（選択中）' : '')
      })) + '><span class="ui-navigation-label">' + escapeHtml(options.label) + '</span></md-filled-tonal-button>';
    }
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = { dialogHeadlineHtml, summaryCardHtml, choiceGroupHtml, navigationItemHtml, tipHtml };
    }
