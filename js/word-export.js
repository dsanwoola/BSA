/* Checkam Word export. Letter content stays on-device; no conversion service.
 * docx 9.6.1 (MIT) is vendored and loaded only when a Word download is requested.
 */
(function (root) {
  "use strict";
  var loading;
  var isNode = typeof module !== "undefined" && module.exports;
  function loadLibrary() {
    if (isNode) return Promise.resolve(require("../vendor/docx-9.6.1.js"));
    if (root.docx) return Promise.resolve(root.docx);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "vendor/docx-9.6.1.js";
      script.onload = function () {
        if (root.docx) resolve(root.docx);
        else { script.remove(); loading = null; reject(new Error("Word export could not load.")); }
      };
      script.onerror = function () {
        script.remove(); loading = null;
        reject(new Error("Word export could not load. Check your connection and try again."));
      };
      document.head.appendChild(script);
    });
    return loading;
  }

  function buildDocument(d, text) {
    // Preserve editable preview text, including blank lines. Strip only XML 1.0
    // control characters that cannot legally appear in a Word document.
    var lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n")
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, "").split("\n");
    var configs = [], previousNumber = null, reference = null;
    var signatureStart = lines.findIndex(function (line) { return /^Yours (faithfully|sincerely),$/i.test(line.trim()); });
    var lastContent = lines.length - 1;
    while (lastContent > 0 && !lines[lastContent].trim()) lastContent--;
    var paragraphs = lines.map(function (line, index) {
      var options = { style: "LetterLine" };
      var item = line.match(/^(\d{1,6})\.\s+(.*)$/);
      if (item) {
        var number = Number(item[1]);
        if (reference === null || number !== previousNumber + 1) {
          reference = "finding-" + configs.length;
          configs.push({ reference: reference, levels: [{ level: 0, start: number,
            format: d.LevelFormat.DECIMAL, text: "%1.", alignment: d.AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 },
              spacing: { before: 0, after: 160, line: 280 } } } }] });
        }
        previousNumber = number;
        options.numbering = { reference: reference, level: 0 };
        options.style = "Finding";
        options.keepNext = /^\s{3}/.test(lines[index + 1] || "");
        line = item[2];
      } else if (/^\s{3}/.test(line) && reference !== null) {
        options.style = "FindingDetail";
        options.keepNext = /^\s{3}/.test(lines[index + 1] || "");
        line = line.slice(3);
      } else if (/^(FORMAL COMPLAINT:|TOTAL REFUND DEMANDED:)/.test(line)) {
        options.style = "LetterEmphasis";
      } else if (!line) {
        options.style = "BlankLine";
      }
      // Keep the sign-off, name and contact block on the same page.
      if (signatureStart >= 0 && index >= signatureStart && index < lastContent) options.keepNext = true;
      options.children = [new d.TextRun({ text: line })];
      return new d.Paragraph(options);
    });
    // Standard business typography. Named letter-specific overrides retain the
    // source's blank-line spacing and use black, modestly sized subject lines.
    return new d.Document({
      creator: "Checkam", title: "Refund demand letter", description: "",
      styles: { default: { document: {
        run: { font: "Calibri", size: 22, color: "000000" },
        paragraph: { spacing: { before: 0, after: 120, line: 264 }, widowControl: true }
      } }, paragraphStyles: [
        { id: "Normal", name: "Normal", run: { font: "Calibri", size: 22, color: "000000" },
          paragraph: { spacing: { before: 0, after: 120, line: 264 }, widowControl: true } },
        { id: "LetterLine", name: "Letter text", basedOn: "Normal",
          paragraph: { spacing: { before: 0, after: 0, line: 264 } } },
        { id: "LetterEmphasis", name: "Letter emphasis", basedOn: "Normal", next: "Normal",
          run: { bold: true }, paragraph: { keepNext: true, keepLines: true } },
        { id: "Finding", name: "Numbered finding", basedOn: "Normal",
          paragraph: { spacing: { before: 0, after: 160, line: 280 } } },
        { id: "FindingDetail", name: "Finding basis", basedOn: "Normal",
          paragraph: { indent: { left: 720 }, spacing: { before: 0, after: 120, line: 264 } } },
        { id: "BlankLine", name: "Letter blank line", basedOn: "Normal", run: { size: 12 },
          paragraph: { spacing: { before: 0, after: 0, line: 120, lineRule: d.LineRuleType.EXACT } } }
      ] },
      numbering: { config: configs },
      sections: [{ properties: { page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, bottom: 1440, left: 1440, right: 1440, header: 708, footer: 708 }
      } }, children: paragraphs }]
    });
  }

  var api = {
    toBlob: function (text) {
      return loadLibrary().then(function (d) { return d.Packer.toBlob(buildDocument(d, text)); });
    }
  };
  if (isNode) module.exports = api;
  else root.BSA_WORD_EXPORT = api;
})(typeof window !== "undefined" ? window : this);
