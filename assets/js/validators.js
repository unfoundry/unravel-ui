/**
 * Unravel - Robust Client-Side Validation Engine
 * Zero-dependency field and data validation engine
 */

class UnravelValidator {
  /**
   * UK NHS Number Validation using Modulus 11 Algorithm
   * Format: 10 digits. The 10th digit is a checksum.
   * Multiply each of the first 9 digits by weights 10 down to 2.
   * Sum the products, calculate remainder mod 11.
   * Check digit = 11 - remainder. If check digit is 11, it becomes 0. If 10, the number is invalid.
   */
  static isNHSNumber(val) {
    if (val === null || val === undefined || val === '') return { valid: false, error: "NHS number is empty" };
    
    // Clean spaces and hyphens
    const cleanStr = String(val).replace(/[\s\-]/g, '');
    
    if (!/^\d{10}$/.test(cleanStr)) {
      return { valid: false, error: "Must be exactly 10 digits" };
    }

    const weights = [10, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += parseInt(cleanStr.charAt(i), 10) * weights[i];
    }

    const remainder = sum % 11;
    let checkDigit = 11 - remainder;
    if (checkDigit === 11) checkDigit = 0;
    
    // If check digit is 10, the NHS number is reserved/invalid by specification
    if (checkDigit === 10) {
      return { valid: false, error: "Invalid NHS Checksum (Mod 11 = 10 reserved)" };
    }

    const actualCheckDigit = parseInt(cleanStr.charAt(9), 10);
    if (checkDigit === actualCheckDigit) {
      return { valid: true };
    } else {
      return { valid: false, error: `Invalid NHS Checksum (expected ${checkDigit}, got ${actualCheckDigit})` };
    }
  }

  /**
   * UK Postcode Validation
   * Supports standard UK postcodes including outward and inward codes (e.g. SW1A 1AA, EC1A 1BB, M1 1AE, B33 8TH)
   */
  static isPostcode(val) {
    if (!val || String(val).trim() === '') return { valid: false, error: "Postcode is empty" };
    const cleanStr = String(val).trim().toUpperCase();
    
    // Standard UK Postcode regex
    const ukPostcodeRegex = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/;
    if (ukPostcodeRegex.test(cleanStr)) {
      return { valid: true };
    }
    return { valid: false, error: "Invalid UK Postcode format" };
  }

  /**
   * Standard RFC 5322 Compliant Email Validation
   */
  static isEmail(val) {
    if (!val || String(val).trim() === '') return { valid: false, error: "Email is empty" };
    const cleanStr = String(val).trim();
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    if (emailRegex.test(cleanStr)) {
      return { valid: true };
    }
    return { valid: false, error: "Invalid email address format" };
  }

  /**
   * UK Phone Number Validation
   * Supports UK landlines, mobiles (+44, 01, 02, 07, 08 prefixes)
   */
  static isPhoneNumber(val) {
    if (!val || String(val).trim() === '') return { valid: false, error: "Phone number is empty" };
    const cleanStr = String(val).replace(/[\s\-\(\)]/g, '');
    const ukPhoneRegex = /^(?:(?:\+44\s?|0044\s?|0)7\d{9}|(?:\+44\s?|0044\s?|0)[12389]\d{8,9})$/;
    if (ukPhoneRegex.test(cleanStr)) {
      return { valid: true };
    }
    return { valid: false, error: "Invalid UK phone number" };
  }

  /**
   * General Numeric Validation
   */
  static isNumber(val) {
    if (val === null || val === undefined || String(val).trim() === '') {
      return { valid: false, error: "Value is empty" };
    }
    const cleanStr = String(val).replace(/,/g, '').trim();
    if (!isNaN(Number(cleanStr)) && isFinite(Number(cleanStr))) {
      return { valid: true };
    }
    return { valid: false, error: "Must be a valid number" };
  }

  /**
   * Integer Validation
   */
  static isInteger(val) {
    if (val === null || val === undefined || String(val).trim() === '') {
      return { valid: false, error: "Value is empty" };
    }
    const cleanStr = String(val).trim();
    if (/^-?\d+$/.test(cleanStr)) {
      return { valid: true };
    }
    return { valid: false, error: "Must be a whole integer" };
  }

  /**
   * Alphanumeric Validation
   */
  static isAlphanumeric(val) {
    if (!val || String(val).trim() === '') return { valid: false, error: "Value is empty" };
    if (/^[a-zA-Z0-9]+$/.test(String(val).trim())) {
      return { valid: true };
    }
    return { valid: false, error: "Must be alphanumeric (letters and numbers only)" };
  }

  /**
   * Custom Regex Match
   */
  static matchRegex(val, pattern, customError) {
    if (val === null || val === undefined) return { valid: false, error: customError || "Value is empty" };
    try {
      const regex = new RegExp(pattern);
      if (regex.test(String(val))) {
        return { valid: true };
      }
      return { valid: false, error: customError || `Does not match pattern: ${pattern}` };
    } catch (e) {
      return { valid: false, error: `Invalid regex pattern: ${e.message}` };
    }
  }

  /**
   * Numeric Range Validations
   */
  static isMinValue(val, min) {
    if (val === null || val === undefined || val === '') return { valid: false, error: "Value is empty" };
    const num = parseFloat(String(val).replace(/[^-0-9.]/g, ''));
    if (isNaN(num)) return { valid: false, error: "Not a valid number" };
    if (num < min) return { valid: false, error: `Must be at least ${min}` };
    return { valid: true };
  }

  static isMaxValue(val, max) {
    if (val === null || val === undefined || val === '') return { valid: false, error: "Value is empty" };
    const num = parseFloat(String(val).replace(/[^-0-9.]/g, ''));
    if (isNaN(num)) return { valid: false, error: "Not a valid number" };
    if (num > max) return { valid: false, error: `Must not exceed ${max}` };
    return { valid: true };
  }

  /**
   * Run a list of validation rule configs on a cell value
   * @param {*} value
   * @param {Array} validations - Array of { type, pattern, errorMessage, min, max } or string type names
   * @param {boolean} isRequired - Whether empty value is an immediate failure
   */
  static validate(value, validations = [], isRequired = false) {
    const strVal = value !== null && value !== undefined ? String(value).trim() : '';

    if (!strVal) {
      if (isRequired) {
        return { 
          valid: false, 
          error: "Required field is missing" 
        };
      }
      // If optional and empty, passes validation
      return { valid: true };
    }

    for (const rule of validations) {
      const ruleType = typeof rule === 'string' ? rule : rule.type;
      let result = { valid: true };

      switch (ruleType) {
        case 'IsNHSNumber':
          result = UnravelValidator.isNHSNumber(strVal);
          break;
        case 'IsPostcode':
          result = UnravelValidator.isPostcode(strVal);
          break;
        case 'IsEmail':
          result = UnravelValidator.isEmail(strVal);
          break;
        case 'IsPhoneNumber':
          result = UnravelValidator.isPhoneNumber(strVal);
          break;
        case 'IsNumber':
          result = UnravelValidator.isNumber(strVal);
          break;
        case 'IsInteger':
          result = UnravelValidator.isInteger(strVal);
          break;
        case 'IsAlphanumeric':
          result = UnravelValidator.isAlphanumeric(strVal);
          break;
        case 'MinValue':
          result = UnravelValidator.isMinValue(strVal, rule.min !== undefined ? rule.min : rule.param);
          break;
        case 'MaxValue':
          result = UnravelValidator.isMaxValue(strVal, rule.max !== undefined ? rule.max : rule.param);
          break;
        case 'MatchRegex':
          result = UnravelValidator.matchRegex(strVal, rule.pattern, rule.errorMessage);
          break;
        default:
          break;
      }

      if (!result.valid) {
        return result; // return the first failure encountered
      }
    }

    return { valid: true };
  }

  // =========================================================================
  // TRANSFORMATIONS & TYPE CASTING ENGINE
  // =========================================================================

  /**
   * Apply a single transformation / type-cast to a value
   */
  static applyTransform(val, transformConfig) {
    if (val === null || val === undefined) return val;
    const type = typeof transformConfig === 'string' ? transformConfig.toUpperCase() : (transformConfig.type || '').toUpperCase();
    
    switch (type) {
      case 'TRIM':
        return String(val).trim();
      case 'UPPERCASE':
        return String(val).toUpperCase();
      case 'LOWERCASE':
        return String(val).toLowerCase();
      case 'CAPITALIZE':
        return String(val).replace(/\b\w/g, l => l.toUpperCase());

      // Type Casting Transforms
      case 'CAST_INTEGER':
      case 'INTEGER': {
        const clean = String(val).replace(/[^-0-9.]/g, '');
        if (clean === '' || clean === '-') return val;
        const parsed = parseFloat(clean);
        return isNaN(parsed) ? val : Math.round(parsed);
      }

      case 'CAST_FLOAT':
      case 'FLOAT': {
        const clean = String(val).replace(/[^-0-9.]/g, '');
        if (clean === '' || clean === '-') return val;
        const parsed = parseFloat(clean);
        if (isNaN(parsed)) return val;
        const prec = (typeof transformConfig === 'object' && transformConfig.precision !== undefined) ? parseInt(transformConfig.precision) : null;
        return (prec !== null && !isNaN(prec)) ? parseFloat(parsed.toFixed(prec)) : parsed;
      }

      case 'CAST_STRING':
      case 'STRING':
        return String(val).trim();

      case 'CAST_BOOLEAN':
      case 'BOOLEAN': {
        const s = String(val).trim().toLowerCase();
        if (['true', '1', 'yes', 'y'].includes(s)) return true;
        if (['false', '0', 'no', 'n'].includes(s)) return false;
        return !!val;
      }

      case 'CAST_DATE':
      case 'DATE_FORMAT': {
        if (window.dayjs) {
          const srcFmt = typeof transformConfig === 'object' ? transformConfig.dateFormatSource : null;
          const tgtFmt = (typeof transformConfig === 'object' && transformConfig.dateFormatTarget) ? transformConfig.dateFormatTarget : 'YYYY-MM-DD';
          const d = srcFmt ? window.dayjs(String(val), srcFmt, true) : window.dayjs(String(val));
          return d.isValid() ? d.format(tgtFmt) : val;
        }
        return val;
      }

      default:
        return val;
    }
  }

  /**
   * Apply an ordered pipeline of transformations
   */
  static applyTransforms(val, transforms = []) {
    let current = val;
    const list = Array.isArray(transforms) ? transforms : (transforms ? [transforms] : []);
    for (const t of list) {
      if (!t) continue;
      current = UnravelValidator.applyTransform(current, t);
    }
    return current;
  }

  // =========================================================================
  // CALCULATED COLUMNS EXPRESSION EVALUATOR
  // =========================================================================

  /**
   * Safely evaluate a calculated column expression using bracketed token syntax:
   * e.g. "[sale_qty] * [sale_unit_price]" or "([sale_qty] > 100) ? 'large' : 'small'"
   */
  static evaluateExpression(expression, row) {
    if (!expression || typeof expression !== 'string') return null;

    try {
      // 1. Tokenize bracketed column references [col_key] -> row['col_key']
      const sanitizedExpr = expression.replace(/\[([a-zA-Z0-9_\-]+)\]/g, (match, key) => {
        return `(__row["${key}"] !== undefined ? __row["${key}"] : 0)`;
      });

      // 2. Evaluate in safe scoped function
      const fn = new Function('__row', 'Math', `
        "use strict";
        try {
          return (${sanitizedExpr});
        } catch(e) {
          return null;
        }
      `);

      const res = fn(row, Math);
      return res !== undefined ? res : null;
    } catch (err) {
      console.warn("Expression evaluation error:", expression, err);
      return null;
    }
  }

  // =========================================================================
  // PRE-VALIDATION INGESTION ROW FILTERS
  // =========================================================================

  /**
   * Evaluate whether a row matches a single filter condition
   * Operators: =, !=, >, >=, <, <=, contains, not_empty
   */
  static evaluateFilterRule(row, rule) {
    if (!rule || !rule.column) return { match: true };
    const colKey = rule.column;
    const rawVal = row[colKey] !== undefined ? row[colKey] : null;
    const op = (rule.op || rule.operator || '=').trim();
    const filterType = (rule.type || ((typeof rule.value === 'number' || ['>', '>=', '<', '<='].includes(op)) ? 'number' : 'string')).toLowerCase();

    // Check not_empty
    if (op === 'not_empty') {
      const match = rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== '';
      return { match, reason: match ? '' : `Column [${colKey}] must not be empty` };
    }

    if (filterType === 'number') {
      const numVal = parseFloat(String(rawVal !== null ? rawVal : '').replace(/[^-0-9.]/g, ''));
      const targetNum = parseFloat(rule.value);
      if (isNaN(numVal)) {
        return { match: false, reason: `Column [${colKey}] (${rawVal}) is not a valid number` };
      }

      let match = false;
      switch (op) {
        case '=':  match = (numVal === targetNum); break;
        case '!=': match = (numVal !== targetNum); break;
        case '>':  match = (numVal > targetNum); break;
        case '>=': match = (numVal >= targetNum); break;
        case '<':  match = (numVal < targetNum); break;
        case '<=': match = (numVal <= targetNum); break;
        default:   match = true; break;
      }
      return {
        match,
        reason: match ? '' : `Column [${colKey}] (${numVal}) failed condition ${op} ${targetNum}`
      };
    } else {
      const strVal = (rawVal !== null && rawVal !== undefined ? String(rawVal) : '').trim().toLowerCase();
      const targetStr = (rule.value !== null && rule.value !== undefined ? String(rule.value) : '').trim().toLowerCase();

      let match = false;
      switch (op) {
        case '=':        match = (strVal === targetStr); break;
        case '!=':       match = (strVal !== targetStr); break;
        case 'contains': match = strVal.includes(targetStr); break;
        default:         match = (strVal === targetStr); break;
      }
      return {
        match,
        reason: match ? '' : `Column [${colKey}] ('${rawVal}') failed condition ${op} '${rule.value}'`
      };
    }
  }

  /**
   * Filter an array of rows based on row_filters schema
   * Returns { cleanRows: [...], excludedRows: [...] }
   */
  static applyRowFilters(rows = [], rowFiltersConfig) {
    if (!rowFiltersConfig || !Array.isArray(rowFiltersConfig.rules) || rowFiltersConfig.rules.length === 0) {
      return { cleanRows: rows, excludedRows: [] };
    }

    const combine = (rowFiltersConfig.combine || 'AND').toUpperCase();
    const cleanRows = [];
    const excludedRows = [];

    for (const row of rows) {
      const results = rowFiltersConfig.rules.map(rule => UnravelValidator.evaluateFilterRule(row, rule));
      
      let passes = false;
      let failureReason = '';

      if (combine === 'OR') {
        passes = results.some(r => r.match);
        if (!passes) {
          failureReason = results.map(r => r.reason).filter(Boolean).join('; ');
        }
      } else {
        // AND
        passes = results.every(r => r.match);
        if (!passes) {
          failureReason = results.filter(r => !r.match).map(r => r.reason).join('; ');
        }
      }

      if (passes) {
        cleanRows.push(row);
      } else {
        excludedRows.push({
          ...row,
          _exclusion_reason: failureReason || 'Failed filter criteria'
        });
      }
    }

    return { cleanRows, excludedRows };
  }
}

if (typeof window !== 'undefined') {
  window.UnravelValidator = UnravelValidator;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UnravelValidator;
}
