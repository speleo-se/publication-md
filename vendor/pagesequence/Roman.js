const RomanLookup = {
  M: 1000,
  CM: 900,
  D: 500,
  CD: 400,
  C: 100,
  XC: 90,
  L: 50,
  XL: 40,
  X: 10,
  IX: 9,
  V: 5,
  IV: 4,
  I: 1
};
/** Regexp pattern for valid roman numbers */ export const romanPattern = /(?<=^|[^a-z])(?=[MDCLXVI])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})(?=[^a-z]|$)/i;
/**
 * Convert 6 to IV
 * @param num 
 * @param lowerCase 
 * @returns 
 */ export function toRoman(num, lowerCase = false) {
  let result = "";
  Object.entries(RomanLookup).forEach(([key, value])=>{
    while(num >= value){
      result += key;
      num -= value;
    }
  });
  return lowerCase ? result.toLowerCase() : result;
}
/**
 * Convert IV to 6
 * @param roman 
 * @returns 
 */ export function fromRoman(roman = "") {
  roman = roman.toUpperCase();
  return Object.entries(RomanLookup).reduce((result, [key, value])=>{
    while(roman.startsWith(key)){
      result += value;
      roman = roman.substring(key.length);
    }
    return result;
  }, 0);
}
//# sourceMappingURL=Roman.js.map