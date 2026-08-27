"use strict";
var assert = require("assert");
var zlib = require("zlib");
var exporter = require("../js/word-export.js");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

// Read the archive's central directory, including deflated entries. This also
// catches the text/BOM corruption that can occur when reusing a CSV downloader.
function parts(buffer) {
  var end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert(end >= 0, "DOCX has a ZIP end record");
  var pos = buffer.readUInt32LE(end + 16), count = buffer.readUInt16LE(end + 10), files = {};
  for (var i = 0; i < count; i++) {
    assert.strictEqual(buffer.readUInt32LE(pos), 0x02014b50);
    var method = buffer.readUInt16LE(pos + 10), size = buffer.readUInt32LE(pos + 20);
    var nameLength = buffer.readUInt16LE(pos + 28), extra = buffer.readUInt16LE(pos + 30);
    var comment = buffer.readUInt16LE(pos + 32), offset = buffer.readUInt32LE(pos + 42);
    var name = buffer.toString("utf8", pos + 46, pos + 46 + nameLength);
    var start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    var bytes = buffer.subarray(start, start + size);
    files[name] = (method === 8 ? zlib.inflateRawSync(bytes) : bytes).toString("utf8");
    pos += 46 + nameLength + extra + comment;
  }
  return files;
}

module.exports = async function (check) {
  var text = '27 August 2026\r\n\r\nThe Branch Manager\r\nBank & Sons <Lagos>\r\n\r\n' +
    'FORMAL COMPLAINT: Refund of ₦5,000 — edited by José\r\n\r\n' +
    '1. First charge — ₦3,000.\r\n   Basis: CBN §2 & evidence.\r\n' +
    '2. Second charge — ₦2,000.\r\n   Basis: rule 4.\r\n\r\n' +
    'TOTAL REFUND DEMANDED: ₦5,000\r\n\r\nYours faithfully,\r\n[Your full name]\r\n';
  var blob = await exporter.toBlob(text);
  var buffer = Buffer.from(await blob.arrayBuffer());
  var files = parts(buffer), xml = files['word/document.xml'];
  check("word: produces a genuine DOCX ZIP and correct MIME", buffer.readUInt32LE(0) === 0x04034b50 && blob.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  check("word: package has document, relationships, styles and numbering", !!xml && !!files['[Content_Types].xml'] && !!files['_rels/.rels'] && !!files['word/styles.xml'] && !!files['word/numbering.xml']);
  check("word: preview edits, Unicode and XML-sensitive text survive", xml.includes('Bank &amp; Sons &lt;Lagos&gt;') && xml.includes('₦5,000 — edited by José') && xml.includes('CBN §2 &amp; evidence.'));
  check("word: findings are editable Word numbered paragraphs", (xml.match(/<w:numPr>/g) || []).length === 2 && !xml.includes('1. First charge') && files['word/numbering.xml'].includes('decimal'));
  check("word: blank lines, signature and letter emphasis retained", xml.includes('[Your full name]') && xml.includes('BlankLine') && xml.includes('LetterEmphasis') && xml.includes('FindingDetail'));
  check("word: page geometry and no external relationships", xml.includes('w:w="12240"') && xml.includes('w:left="1440"') && !Object.keys(files).some(function (key) { return /\.rels$/.test(key) && files[key].includes('TargetMode="External"'); }));
  var second = parts(Buffer.from(await (await exporter.toBlob('My second edited letter\u0001\nOnly this text')).arrayBuffer()));
  check("word: fresh exports do not reuse previous letter or illegal controls", second['word/document.xml'].includes('My second edited letter') && !second['word/document.xml'].includes('José') && !second['word/document.xml'].includes('\u0001'));
  var empty = parts(Buffer.from(await (await exporter.toBlob('')).arrayBuffer()));
  check("word: empty edited preview remains a valid document", !!empty['word/document.xml']);
  var app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
  var downloadCode = app.slice(app.indexOf('  function download(name,'), app.indexOf('  /* ---------------- boot'));
  var downloaded, anchor;
  var context = { Blob: Blob, URL: { createObjectURL: function (value) { downloaded = value; return 'blob:test'; }, revokeObjectURL: function () {} },
    document: { createElement: function () { anchor = { click: function () {}, remove: function () {} }; return anchor; }, body: { appendChild: function () {} } },
    setTimeout: function (fn) { fn(); } };
  vm.runInNewContext(downloadCode + '\nthis.save = download;', context);
  context.save('refund_demand_letter.docx', blob);
  check("word: actual download handler preserves binary Blob and filename", downloaded === blob && anchor.download === 'refund_demand_letter.docx');
  context.save('audit_findings.csv', 'Amount,5000', 'text/csv');
  check("word: existing CSV downloads retain UTF-8 BOM", Buffer.from(await downloaded.arrayBuffer()).subarray(0, 3).equals(Buffer.from([239, 187, 191])));
};
