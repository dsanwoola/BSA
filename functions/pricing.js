/* =========================================================================
 * PRICING — what an unlock costs, computed the same way on both sides.
 * =========================================================================
 * This file is SHARED. `functions/pricing.js` must stay byte-identical to
 * `js/pricing.js`; the test suite fails the build if they drift, because a
 * client that quotes one price and a server that charges another is a bug
 * that only ever shows up in production, on a real customer's card.
 *
 * The rule, as set by the product owner:
 *   individual statement, 6 months or below  →  ₦3,000
 *   business statement,   per 6 months       →  ₦5,000
 *
 * "Per 6 months" is charged in whole blocks: a statement covering more than
 * one block costs one unit per block started. A 6-month block is defined as
 * 183 days (365.25 / 2) rather than as calendar months, so that a statement
 * running 5 Jan – 1 Jul — which touches seven calendar months but is really
 * under six months long — is billed as one block and not two.
 * ========================================================================= */

(function (global) {
  "use strict";

  var CURRENCY = "NGN";
  var BLOCK_DAYS = 183;           // one "6-month" billing block
  var MS_PER_DAY = 86400000;

  /* Naira per block, by who owns the account. CBN treats government/MDA
   * accounts as corporate, and the engine already classifies them that way
   * (js/engine.js: holderClass), so they price as business. */
  var RATE_BY_HOLDER = {
    individual: 3000,
    business: 5000,
    government: 5000
  };

  function toDate(value) {
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === "number") {
      var fromNum = new Date(value);
      return isNaN(fromNum.getTime()) ? null : fromNum;
    }
    if (typeof value === "string" && value) {
      var fromStr = new Date(value);
      return isNaN(fromStr.getTime()) ? null : fromStr;
    }
    return null;
  }

  /* Whole days between two dates, inclusive of both endpoints: a statement
   * dated 1 Jan – 1 Jan covers one day, not zero. */
  function daysCovered(from, to) {
    var a = toDate(from), b = toDate(to);
    if (!a || !b) return null;
    if (b < a) { var swap = a; a = b; b = swap; }
    return Math.floor((b - a) / MS_PER_DAY) + 1;
  }

  /* Approximate calendar months, for display only — never for pricing. */
  function monthsCovered(from, to) {
    var days = daysCovered(from, to);
    if (days === null) return null;
    return Math.round((days / 30.4375) * 10) / 10;
  }

  function blocksForDays(days) {
    if (days === null || !isFinite(days) || days <= 0) return 1;
    return Math.max(1, Math.ceil(days / BLOCK_DAYS));
  }

  function normaliseHolder(holderType) {
    var key = String(holderType || "").toLowerCase();
    return Object.prototype.hasOwnProperty.call(RATE_BY_HOLDER, key) ? key : "individual";
  }

  /**
   * Price an unlock.
   * @param {Object} input  {holderType, from, to}
   * @return {Object} quote — amount is in whole naira, ready for Flutterwave.
   *
   * An unreadable or missing period bills as a single block. That is the
   * cheapest outcome, so a parsing failure can never overcharge someone.
   */
  function quote(input) {
    input = input || {};
    var holderType = normaliseHolder(input.holderType);
    var unitAmount = RATE_BY_HOLDER[holderType];
    var days = daysCovered(input.from, input.to);
    var blocks = blocksForDays(days);

    return {
      holderType: holderType,
      currency: CURRENCY,
      days: days,
      months: monthsCovered(input.from, input.to),
      blocks: blocks,
      blockDays: BLOCK_DAYS,
      unitAmount: unitAmount,
      amount: unitAmount * blocks,
      periodKnown: days !== null
    };
  }

  /** ₦3,000 — for labels. Kept here so client and receipt agree. */
  function formatNaira(amount) {
    var n = Number(amount) || 0;
    return "₦" + n.toLocaleString("en-NG", { maximumFractionDigits: 0 });
  }

  /** "1 × 6-month block (individual)" — the line item a payer sees. */
  function describe(q) {
    var who = q.holderType === "individual" ? "individual" : "business";
    var blockLabel = q.blocks === 1 ? "1 × 6-month block" : q.blocks + " × 6-month blocks";
    return blockLabel + " (" + who + ", " + formatNaira(q.unitAmount) + " each)";
  }

  var API = {
    CURRENCY: CURRENCY,
    BLOCK_DAYS: BLOCK_DAYS,
    RATE_BY_HOLDER: RATE_BY_HOLDER,
    quote: quote,
    daysCovered: daysCovered,
    monthsCovered: monthsCovered,
    blocksForDays: blocksForDays,
    normaliseHolder: normaliseHolder,
    formatNaira: formatNaira,
    describe: describe
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else global.CBN_PRICING = API;

})(typeof window !== "undefined" ? window : globalThis);
