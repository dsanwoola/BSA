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
      id: "gtbank", name: "Guaranty Trust Bank Ltd (GTBank)", confidence: "partial-current", sourceLabel: "GTBank product/FAQ pages and GTBusiness forms surfaced", sourceUrl: "https://www.gtbank.com/business-banking/sme-banking/business-accounts/gt-business-account",
      aliases: ["GTBANK", "GTB", "GTCO", "GUARANTY TRUST BANK", "GTWORLD"],
      notes: ["Deeper crawl captured GTBank product evidence: GT Business Platinum has monthly CAMF-free turnover of ₦100m and fixed charge ₦10,000, with ₦1/mille CAMF applied on excess turnover in GTBusiness forms; GTBank virtual naira Mastercard issuance is ₦500+VAT; dollar debit Mastercard ATM withdrawal fee is $3.50; Quick Credit restructuring fee is 0.5% of outstanding amount. No consolidated current tariff PDF was captured."],
      publicBankSchedule: { virtualCardIssuanceMax: 500, businessPlatinumFixedMonthlyCharge: 10000, businessPlatinumCamfFreeTurnover: 100000000, facilityRestructuringRate: 0.005, dollarAtmWithdrawalFeeUSD: 3.5 }
    },
    zenith: {
      id: "zenith", name: "Zenith Bank Plc", confidence: "older-regulatory", sourceLabel: "Zenith hosted Guide to Bank Charges PDF", sourceUrl: "https://www.digital.zenithbank.com/pdfs/guide-to-bank-charges.pdf",
      aliases: ["ZENITH", "ZENITH BANK"], notes: ["Zenith source captured was an older regulatory guide hosted on Zenith; use date-aware CBN baseline for changed 2025/2026 rules."], publicBankSchedule: {}
    },
    polaris: {
      id: "polaris", name: "Polaris Bank Ltd", confidence: "older-regulatory", sourceLabel: "Polaris hosted 2017 CBN Guide/Circular", sourceUrl: "https://www.polarisbanklimited.com/images/regulatorypublications/CircularonGuidetoBankChargestoallBanksandOtherFinancialInstitutions-CBNApril2017.pdf",
      aliases: ["POLARIS", "POLARIS BANK", "SKYE BANK"], notes: ["Polaris source captured was an older CBN regulatory guide; use date-aware CBN baseline for changed rules."], publicBankSchedule: {}
    },
    ecobank: {
      id: "ecobank", name: "Ecobank Nigeria Ltd", confidence: "partial-current", sourceLabel: "Ecobank Nigeria Xpress Point tariff/FAQ page", sourceUrl: "https://www.ecobank.com/ng/personal-banking/ways-to-bank/xpress-point",
      aliases: ["ECOBANK"],
      notes: ["Deeper crawl found Ecobank Nigeria Xpress Point page with official tariff section and FAQ. It confirms Xpress Account opening/monthly maintenance is free, and agent-channel transfers, deposits, utility bills and withdrawals may carry small transaction fees displayed on the agent app/location. The downloadable tariff endpoint referenced by the page returned 404 during crawl, so common bank-statement charges still use CBN baseline."],
      publicBankSchedule: { xpressAccountMonthlyMaintenanceMax: 0 }
    },
    fcmb: {
      id: "fcmb", name: "First City Monument Bank Ltd (FCMB)", confidence: "partial-current", sourceLabel: "FCMB open-a-business-account and online-account FAQ pages", sourceUrl: "https://www.fcmb.com/open-a-business-account",
      aliases: ["FCMB", "FIRST CITY MONUMENT BANK"],
      notes: ["Deeper crawl captured FCMB business account terms: free banking for first 90 days, zero account maintenance fee up to ₦40m debit turnover, ₦5,000 minimum operating balance, and fixed charge as low as ₦6,350 on ₦40m debit turnover. No consolidated tariff PDF was captured."],
      publicBankSchedule: { businessFreeBankingDays: 90, businessCamfFreeTurnover: 40000000, businessFixedChargeAt40m: 6350, businessMinOperatingBalance: 5000 }
    },
    fidelity: {
      id: "fidelity", name: "Fidelity Bank Plc", confidence: "partial-current", sourceLabel: "Fidelity low-cost SME current account page", sourceUrl: "https://www.fidelitybank.ng/sme-banking/low-cost-current-account-offerings",
      aliases: ["FIDELITY", "FIDELITY BANK"],
      notes: ["Deeper crawl captured Fidelity SME account pricing: FSBA variants advertise no fixed monthly maintenance charge and ₦1/mille only when minimum balance or monthly turnover thresholds are breached; Premium Business Account Variant 2 has zero account maintenance charge unless balance goes below ₦1m; Fidelity Business Plus charges ₦0.40k or ₦0.30k per debit turnover amount depending on variant. No consolidated tariff PDF was captured."],
      publicBankSchedule: { fsbaCamfRatePerMille: 1, fsbaStarterMinBalance: 10000, fsbaStarterTurnoverCap: 20000000, fsbaMediumMinBalance: 50000, fsbaMediumTurnoverCap: 50000000, fsbaIndividualMinBalance: 5000, fsbaIndividualTurnoverCap: 5000000, fpbaVariant2MinBalance: 1000000, businessPlusSmallCamfRate: 0.0004, businessPlusMediumCamfRate: 0.0003 }
    },
    wema: {
      id: "wema", name: "Wema Bank Plc / ALAT", confidence: "partial-current", sourceLabel: "Wema/ALAT card and SME pages surfaced", sourceUrl: "https://wemabank.com/personal/cards/credit-cards",
      aliases: ["WEMA", "WEMA BANK", "ALAT"],
      notes: ["Deeper crawl captured Wema card pricing: Classic credit card joining fee ₦1,075 VAT-inclusive, annual fee ₦200, re-issue ₦1,075, PIN re-issue free; Gold credit card joining/re-issue ₦3,500 and annual fee ₦1,500; Wema debit Mastercard source snippet shows card/re-issue ₦1,075 and quarterly maintenance ₦50. Full current tariff PDF was not captured."],
      publicBankSchedule: { cardIssuanceVatInclusiveMax: 1075, cardMaintenanceMax: 50, classicCreditCardAnnualFeeMax: 200, goldCreditCardIssuanceMax: 3500, goldCreditCardAnnualFeeMax: 1500, pinReissueMax: 0 }
    },
    union_titan: { id: "union_titan", name: "Union Bank Nigeria / Titan Trust Bank", confidence: "source-needed", sourceLabel: "Merger/public pages found; no tariff captured", sourceUrl: "https://www.unionbankng.com", aliases: ["UNION BANK", "TITAN TRUST", "TITAN TRUST BANK"], notes: [BASELINE_NOTE], publicBankSchedule: {} },
    providus: {
      id: "providus", name: "Providus Bank Ltd", confidence: "partial-current", sourceLabel: "Providus Platinum Mastercard product page", sourceUrl: "https://www.providusbank.com/platinum-mastercard",
      aliases: ["PROVIDUS", "PROVIDUS BANK"],
      notes: ["Deeper crawl captured Providus Platinum Mastercard fees: issuance ₦1,075 VAT-inclusive, lifestyle enrolment ₦4,300 VAT-inclusive, affluent card service fee ₦32,250 annually VAT-inclusive, and quarterly maintenance ₦53.75 VAT-inclusive for savings account holders only. Common bank-statement charges still use CBN baseline unless the statement clearly identifies this card product."],
      publicBankSchedule: { cardIssuanceVatInclusiveMax: 1075, cardMaintenanceVatInclusiveMax: 53.75, platinumLifestyleEnrolmentMax: 4300, platinumAnnualServiceFeeMax: 32250 }
    },
    keystone: {
      id: "keystone", name: "Keystone Bank Ltd", confidence: "partial-current", sourceLabel: "Keystone commercial banking and loans pages", sourceUrl: "https://www.keystonebankng.com/business-banking/commercial-banking-2",
      aliases: ["KEYSTONE", "KEYSTONE BANK"],
      notes: ["Deeper crawl captured Keystone GrowBiz account and loan pricing: GrowBiz Classic monthly maintenance is ₦1,700 for SME/traders and ₦2,500 for corporates; GrowBiz Gold has no monthly maintenance with ₦50,000 SME/trader or ₦250,000 corporate minimum balance; EduFinance/Sustainable Energy/Micro Lending pages show MPR+9.5% and 1% management fee. Common regulated charges still use CBN baseline."],
      publicBankSchedule: { growBizClassicSmeMonthlyMaintenanceMax: 1700, growBizClassicCorporateMonthlyMaintenanceMax: 2500, growBizGoldSmeMinBalance: 50000, growBizGoldCorporateMinBalance: 250000, loanManagementRate: 0.01 }
    },
    standardchartered: {
      id: "standardchartered", name: "Standard Chartered Bank Nigeria Ltd", confidence: "strong-current", sourceLabel: "Standard Chartered Nigeria Service Fees and Price Guide – March 2026", sourceUrl: "https://av.sc.com/ng/content/docs/ng-tarrif-guide-new.pdf",
      aliases: ["STANDARD CHARTERED", "SCB"],
      notes: ["Deeper crawl captured Standard Chartered Nigeria March 2026 tariff PDF: interbank transfers no charge, bill payment ₦100, SMS transaction alert no charge, hard/soft token no charge, account maintenance no charge, NGN debit card issuance no charge, FCY debit card ₦1,000/equivalent, card replacement ₦1,000/equivalent, SCB ATM free, other-bank ATM ₦100 per ₦20,000 and up to ₦500 surcharge offsite, FCY card maintenance $10 p.a., outward telegraphic transfer Swift cost recovery $25 + 0.5% commission, cashless policy thresholds captured."],
      publicBankSchedule: { eftFeeFor: function () { return 0; }, smsUnitMax: function () { return 0; }, cardIssuanceMax: 0, cardReplacementMax: 1000, billPaymentMax: 100, tokenIssuanceMax: 0, atmOnsitePer20k: 100, atmOffsitePer20k: 600, fcyCardMaintenanceAnnualUSD: 10, outwardSwiftRecoveryUSD: 25, outwardTransferCommissionRate: 0.005 }
    },
    citibank: { id: "citibank", name: "Citibank Nigeria Ltd", confidence: "source-needed", sourceLabel: "No tariff captured in crawl", sourceUrl: "https://www.citigroup.com", aliases: ["CITIBANK", "CITI BANK", "CITI"], notes: ["Corporate/institutional bank; apply CBN baseline and verify negotiated corporate tariff/relationship letter where statement charge is not fixed-cap."], publicBankSchedule: {} },
    noninterest: { id: "noninterest", name: "Non-interest bank (Jaiz / TAJ / Lotus / Alternative Bank)", confidence: "category-profile", sourceLabel: "Jaiz/TAJ/Lotus/Alternative public pages; no full tariff captured", sourceUrl: "https://jaizbankplc.com", aliases: ["JAIZ", "JAIZ BANK", "TAJ", "TAJBANK", "TAJ BANK", "LOTUS", "LOTUS BANK", "ALTERNATIVE BANK", "THE ALTERNATIVE BANK"], notes: ["Deeper crawl found non-interest product/terms pages but no consolidated current service-charge tariff PDF. TAJ terms refer to a Schedule of Charges without publishing exact values in the crawled page. Non-interest profile should avoid interest/loan terminology assumptions; service charges still compare to applicable CBN fee caps where relevant."], publicBankSchedule: {} },
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
