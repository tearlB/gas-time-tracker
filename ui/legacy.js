    // 古い版のデータのための処理（レガシー対応）。
    // 以前は開始日・持ち越し・完了などを予定のメモ欄の先頭に「start:2026-10-19」のように書いていた。
    // 今は専用の列に保存するが、古い予定を読むときはメモ欄から読み取り、表示するメモからは取り除く。
    function parsePlanMeta(note) {
      const lines = String(note || '').split('\n');
      const meta = {};
      let index = 0;
      while (index < lines.length) {
        const match = lines[index].match(/^(start|cap|carry|cal|done|day):(.*)$/);
        if (!match) break;
        meta[match[1]] = match[2].trim();
        index++;
      }
      return { meta: meta, rest: lines.slice(index).join('\n').trim() };
    }
    function normalizePlanYmd(value) {
      const raw = String(value == null ? '' : value).trim().replace(/[\/.]/g, '-');
      const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!match) return '';
      return match[1] + '-' + pad2(match[2]) + '-' + pad2(match[3]);
    }
    function parsePlanStartDate(note) {
      return normalizePlanYmd(parsePlanMeta(note).meta.start || '');
    }
    function parsePlanDailyCap(note) {
      const value = Number(parsePlanMeta(note).meta.cap);
      return isFinite(value) && value > 0 ? roundHours(value) : 0;
    }
    function parsePlanDailyPlan(note) {
      const encoded = parsePlanMeta(note).meta.day || '';
      if (!encoded) return {};
      try { return normalizePlanDailyPlan(JSON.parse(encoded)); }
      catch (_) { return {}; }
    }
    function parsePlanCarryWeek(note) {
      const value = parsePlanMeta(note).meta.carry || '';
      return /^\d{4}-W\d{2}$/.test(value) ? value : '';
    }
    function restPlanNote(note) {
      return parsePlanMeta(note).rest;
    }
    function parsePlanCalendarKey(note) {
      return String(parsePlanMeta(note).meta.cal || '').trim();
    }
    function parsePlanDone(note) {
      const value = String(parsePlanMeta(note).meta.done || '').trim().toLowerCase();
      return value === '1' || value === 'true';
    }
    function parsePlanCompletionOverride(note) {
      const value = parsePlanMeta(note).meta.done;
      return normalizePlanCompletionOverride(value);
    }
