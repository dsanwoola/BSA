/* =========================================================================
 * NIGERIAN BANK CHARGE PROFILES
 * -------------------------------------------------------------------------
 * Bank-specific presentation layer captured from public bank tariff/rates
 * pages and PDFs. These profiles do NOT replace the CBN rules: the engine
 * compares the bank's published presentation with the CBN cap and uses the
 * customer-friendlier/lower ceiling where a bank clearly advertised one.
 * ========================================================================= */
(function (global) {
  "use strict";

  function r2(n) { return Math.round(n * 100) / 100; }
  function d(iso) { var p = iso.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }

  function eftLegacy(amount) {
    if (amount <= 5000) return 10;
    if (amount <= 50000) return 25;
    return 50;
  }
  function eftMay2026(amount) {
    if (amount <= 5000) return 0;
    if (amount <= 50000) return 10;
    return 50;
  }
  function eftLegacyVatInclusive(amount) { return r2(eftLegacy(amount) * 1.075); }

  var BASELINE_NOTE = "No complete current bank-specific tariff was captured in the public crawl; BSA applies the CBN baseline and labels the bank as source-needed.";

  var PROFILES = {
    access: {
      id: "access", name: "Access Bank Plc", confidence: "regulatory-baseline", sourceLabel: "Access hosted CBN Guide to Charges PDF", sourceUrl: "https://www.accessbankplc.com/AccessBankGroup/media/Documents/Guide-to-Charges-by-Banks.pdf",
      aliases: ["ACCESS", "ACCESS BANK", "ACCESS BANK PLC", "DIAMOND BANK"], notes: ["Access source captured was a CBN guide hosted on Access; treat as regulatory baseline rather than a bespoke Access tariff."], publicBankSchedule: {}
    },
    uba: {
      id: "uba", name: "United Bank for Africa Plc (UBA)", confidence: "strong-current", sourceLabel: "UBA Service Charges January 2026", sourceUrl: "https://www.ubagroup.com/nigeria/wp-content/uploads/sites/2/2026/01/UBA-Service-Charges-January-2026.pdf",
      aliases: ["UBA", "UNITED BANK FOR AFRICA", "UNITED BANK FOR AFRICA PLC"],
      notes: ["Current source captured: UBA January 2026 Service Charges. UBA presents NIP as ₦10/₦25/₦50 + VAT, SMS at ₦6/SMS, CAMF ₦1/mille, local other-bank ATM ₦100/up to ₦600 offsite, RTGS ₦950+VAT, returned cheque 1% or ₦5,000."],
      publicBankSchedule: {
        eftFeeFor: eftLegacy,
        smsUnitMax: function () { return 6; },
        cardMaintenanceMax: 50,
        cardIssuanceMax: 1000,
        atmOnsitePer20k: 100,
        atmOffsitePer20k: 600,
        rtgsMax: 950,
        returnedUnfunded: "1% of face value or ₦5,000, whichever is higher"
      }
    },
    stanbic: {
      id: "stanbic", name: "Stanbic IBTC Bank Plc", confidence: "strong-current", sourceLabel: "Stanbic IBTC Bank 2026 Pricing Guide", sourceUrl: "https://www.stanbicibtcbank.com/static_file/Nigeria/nigeriabank/Downloads/Pricing%20Guide/Stanbic%20IBTC%20Bank%202026%20Pricing%20Guide.pdf",
      aliases: ["STANBIC", "STANBIC IBTC", "STANBIC IBTC BANK"],
      notes: ["Current source captured: Stanbic IBTC 2026 Pricing Guide. It presents NIP ₦10/₦25/₦50 + VAT, CAMF ₦1/mille, card issuance/replacement ₦1,075 VAT-inclusive, ATM other-bank branch ₦107.50 and offsite ₦645, RTGS ₦950+VAT."],
      publicBankSchedule: {
        eftFeeFor: eftLegacy,
        cardIssuanceVatInclusiveMax: 1075,
        atmOnsiteVatInclusivePer20k: 107.5,
        atmOffsiteVatInclusivePer20k: 645,
        rtgsMax: 950
      }
    },
    sterling: {
      id: "sterling", name: "Sterling Bank Ltd", confidence: "strong-current", sourceLabel: "Sterling Bank rates page", sourceUrl: "https://sterling.ng/rates",
      aliases: ["STERLING", "STERLING BANK"],
      notes: ["Current source captured: Sterling rates page. It presents VAT-inclusive transfer bands ₦10.75/₦26.88/₦53.75, card maintenance ₦50+VAT, EMTL ₦50, stopped cheque ₦500+VAT, RTGS ₦950+VAT, returned cheque 1% or ₦5,000, and cheque books at ₦2,500+VAT/₦5,000+VAT."],
      publicBankSchedule: {
        eftVatInclusiveFor: eftLegacyVatInclusive,
        cardMaintenanceMax: 50,
        rtgsMax: 950,
        chequeBook50Max: 2500,
        chequeBook100Max: 5000,
        stoppedChequeMax: 500,
        returnedUnfunded: "1% of face value or ₦5,000, whichever is higher"
      }
    },
    firstbank: {
      id: "firstbank", name: "First Bank of Nigeria Ltd", confidence: "partial-current", sourceLabel: "FirstBank FAQ/product pages surfaced in crawl", sourceUrl: "https://www.firstbanknigeria.com/contact/faqs",
      aliases: ["FIRSTBANK", "FIRST BANK", "FIRST BANK OF NIGERIA", "FBN"],
      notes: ["Partial source captured: FirstBank FAQ/product pages reference ₦1/mille CAMF and FIP/NIP transfer bands around ₦10.75/₦26.88/₦53.75 VAT-inclusive. Full tariff PDF was not captured."],
      publicBankSchedule: { eftVatInclusiveFor: eftLegacyVatInclusive }
    },
    gtbank: {
      id: "gtbank", name: "Guaranty Trust Bank Ltd (GTBank)", confidence: "partial", sourceLabel: "GTBank public product/FAQ pages surfaced", sourceUrl: "https://www.gtbank.com",
      aliases: ["GTBANK", "GTB", "GTCO", "GUARANTY TRUST BANK", "GTWORLD"],
      notes: ["Partial source captured: GTBank pages mention ₦1/mille CAMF on qualifying current-account activity and dollar-card annual maintenance; no consolidated tariff PDF was captured."],
      publicBankSchedule: {}
    },
    zenith: {
      id: "zenith", name: "Zenith Bank Plc", confidence: "older-regulatory", sourceLabel: "Zenith hosted Guide to Bank Charges PDF", sourceUrl: "https://www.digital.zenithbank.com/pdfs/guide-to-bank-charges.pdf",
      aliases: ["ZENITH", "ZENITH BANK"], notes: ["Zenith source captured was an older regulatory guide hosted on Zenith; use date-aware CBN baseline for changed 2025/2026 rules."], publicBankSchedule: {}
    },
    polaris: {
      id: "polaris", name: "Polaris Bank Ltd", confidence: "older-regulatory", sourceLabel: "Polaris hosted 2017 CBN Guide/Circular", sourceUrl: "https://www.polarisbanklimited.com/images/regulatorypublications/CircularonGuidetoBankChargestoallBanksandOtherFinancialInstitutions-CBNApril2017.pdf",
      aliases: ["POLARIS", "POLARIS BANK", "SKYE BANK"], notes: ["Polaris source captured was an older CBN regulatory guide; use date-aware CBN baseline for changed rules."], publicBankSchedule: {}
    },
    ecobank: { id: "ecobank", name: "Ecobank Nigeria Ltd", confidence: "source-needed", sourceLabel: "Ecobank pages referenced Tariffs Nigeria; detailed PDF not captured", sourceUrl: "https://www.ecobank.com/ng", aliases: ["ECOBANK"], notes: [BASELINE_NOTE], publicBankSchedule: {} },
    fcmb: { id: "fcmb", name: "First City Monument Bank Ltd (FCMB)", confidence: "source-needed", sourceLabel: "No full tariff captured in crawl", sourceUrl: "https://www.fcmb.com", aliases: ["FCMB", "FIRST CITY MONUMENT BANK"], notes: [BASELINE_NOTE], publicBankSchedule: {} },
    fidelity: { id: "fidelity", name: "Fidelity Bank Plc", confidence: "source-needed", sourceLabel: "No full tariff captured in crawl", sourceUrl: "https://www.fidelitybank.ng", aliases: ["FIDELITY", "FIDELITY BANK"], notes: [BASELINE_NOTE], publicBankSchedule: {} },
    wema: { id: "wema", name: "Wema Bank Plc / ALAT", confidence: "source-needed", sourceLabel: "No full tariff captured in crawl", sourceUrl: "https://www.wemabank.com", aliases: ["WEMA", "WEMA BANK", "ALAT"], notes: [BASELINE_NOTE], publicBankSchedule: {} },
    union_titan: { id: "union_titan", name: "Union Bank Nigeria / Titan Trust Bank", confidence: "source-needed", sourceLabel: "Merger/public pages found; no tariff captured", sourceUrl: "https://www.unionbankng.com", aliases: ["UNION BANK", "TITAN TRUST", "TITAN TRUST BANK"], notes: [BASELINE_NOTE], publicBankSchedule: {} },
    providus: { id: "providus", name: "Providus Bank Ltd", confidence: "partial-product", sourceLabel: "Providus card/product pages surfaced", sourceUrl: "https://www.providusbank.com", aliases: ["PROVIDUS", "PROVIDUS BANK"], notes: ["Only card/product snippets captured; apply CBN baseline for common charges unless product-specific fee is visible on the statement."], publicBankSchedule: {} },
    keystone: { id: "keystone", name: "Keystone Bank Ltd", confidence: "partial-product", sourceLabel: "Keystone product pages surfaced", sourceUrl: "https://www.keystonebankng.com", aliases: ["KEYSTONE", "KEYSTONE BANK"], notes: ["Partial snippets mention commercial monthly maintenance examples; apply CBN baseline for common regulated charges."], publicBankSchedule: {} },
    standardchartered: { id: "standardchartered", name: "Standard Chartered Bank Nigeria Ltd", confidence: "source-needed", sourceLabel: "No Nigeria tariff captured in crawl", sourceUrl: "https://www.sc.com/ng", aliases: ["STANDARD CHARTERED", "SCB"], notes: [BASELINE_NOTE], publicBankSchedule: {} },
    citibank: { id: "citibank", name: "Citibank Nigeria Ltd", confidence: "source-needed", sourceLabel: "No tariff captured in crawl", sourceUrl: "https://www.citigroup.com", aliases: ["CITIBANK", "CITI BANK", "CITI"], notes: ["Corporate/institutional bank; apply CBN baseline and verify negotiated corporate tariff/relationship letter where statement charge is not fixed-cap."], publicBankSchedule: {} },
    noninterest: { id: "noninterest", name: "Non-interest bank (Jaiz / TAJ / Lotus / Alternative Bank)", confidence: "category-profile", sourceLabel: "CBN/NDIC category list; no detailed tariff captured", sourceUrl: "", aliases: ["JAIZ", "TAJ", "LOTUS", "ALTERNATIVE BANK"], notes: ["Non-interest bank profile: avoid interest/loan terminology assumptions; service charges still compare to applicable CBN fee caps where relevant."], publicBankSchedule: {} },
    other: { id: "other", name: "Other / not sure", confidence: "cbn-baseline", sourceLabel: "CBN baseline only", sourceUrl: "", aliases: [], notes: ["No bank selected; BSA applies the CBN baseline only. Select a bank for bank-source labelling and lower advertised caps where captured."], publicBankSchedule: {} }
  };

  var ORDER = ["other", "access", "uba", "stanbic", "sterling", "firstbank", "gtbank", "zenith", "polaris", "ecobank", "fcmb", "fidelity", "wema", "union_titan", "providus", "keystone", "standardchartered", "citibank", "noninterest"];

  function get(id) { return PROFILES[id] || PROFILES.other; }
  function list() { return ORDER.map(get); }
  function detect(text) {
    var n = String(text || "").toUpperCase();
    var best = null;
    ORDER.forEach(function (id) {
      var p = PROFILES[id];
      if (!p || id === "other") return;
      (p.aliases || []).forEach(function (a) {
        if (!best && n.indexOf(a) !== -1) best = p;
      });
    });
    return best || null;
  }

  var API = { profiles: PROFILES, order: ORDER, get: get, list: list, detect: detect, r2: r2, dateOf: d };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else global.CBN_BANK_PROFILES = API;
})(typeof window !== "undefined" ? window : globalThis);
