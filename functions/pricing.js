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
 * one block costs one unit per block started. Blocks span six calendar months
 * from the first covered date, with both statement endpoints included.
 * Jan 1–Jun 30 and Jul 1–Dec 31 each cost one block despite differing lengths.
 * ========================================================================= */

(function (global) {
  "use strict";

  var CURRENCY = "NGN";
  var BLOCK_MONTHS = 6;
  var MS_PER_DAY = 86400000;

  /* Naira per block, by who owns the account. CBN treats government/MDA
   * accounts as corporate, and the engine already classifies them that way
   * (js/engine.js: holderClass), so they price as business. */
  var RATE_BY_HOLDER = {
    individual: 3000,
    business: 5000,
    government: 5000
  };

  // Statements contain civil dates, not instants. Preserve the date shown
  // locally when serializing a parser Date; never shift it through UTC first.
  function dateKey(value) {
    if (value instanceof Date || typeof value === "number") {
      var d = value instanceof Date ? value : new Date(value);
      if (isNaN(d.getTime())) return null;
      return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    }
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return value.slice(0, 10);
    return null;
  }

  function toDate(value) {
    var key = dateKey(value);
    if (!key) return null;
    var d = new Date(key + "T00:00:00.000Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === key ? d : null;
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

  function blocksForPeriod(from, to) {
    var a = toDate(from), b = toDate(to);
    if (!a || !b) return 1;
    if (b < a) { var swap = a; a = b; b = swap; }
    var months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
    var blocks = Math.max(1, Math.floor(months / BLOCK_MONTHS));
    // Use the original start for every boundary to avoid month-end drift.
    // If its day does not exist in the target month, include that whole month
    // (Aug 31–Feb 28 is one block; Mar 1 starts the next).
    var targetMonth = a.getUTCMonth() + blocks * BLOCK_MONTHS;
    var lastDay = new Date(Date.UTC(a.getUTCFullYear(), targetMonth + 1, 0)).getUTCDate();
    var boundary = new Date(Date.UTC(a.getUTCFullYear(), targetMonth, Math.min(a.getUTCDate(), lastDay + 1)));
    return b >= boundary ? blocks + 1 : blocks;
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
    var blocks = blocksForPeriod(input.from, input.to);

    return {
      holderType: holderType,
      currency: CURRENCY,
      days: days,
      months: monthsCovered(input.from, input.to),
      blocks: blocks,
      blockMonths: BLOCK_MONTHS,
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
    BLOCK_MONTHS: BLOCK_MONTHS,
    RATE_BY_HOLDER: RATE_BY_HOLDER,
    quote: quote,
    daysCovered: daysCovered,
    monthsCovered: monthsCovered,
    blocksForPeriod: blocksForPeriod,
    dateKey: dateKey,
    normaliseHolder: normaliseHolder,
    formatNaira: formatNaira,
    describe: describe
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else global.CBN_PRICING = API;

})(typeof window !== "undefined" ? window : globalThis);
