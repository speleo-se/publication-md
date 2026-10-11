import { romanPattern } from "./Roman.js";
import { toRoman, fromRoman } from "./Roman.js";
/**
 * A page sequence is a string describing the numeration of every page in a PDF.
 * The number written on the page is considered a label.
 * 
 * The index is the number of the page in the PDF. (Starting with 0)
 * 
 * If pages for example has been duplicated, it is possible to ignore them by
 * prefixing the section with a !
 * 
 * Pages in the PDF that has mor than one real page, ans therefor more than
 * one label, can be described be using | between 2 labels.
 * 
 * Labels for pages following each other is separated by ,
 * 
 * Enumerations can be described by a range separated by -
 * 
 * The following enumerations are supported:
 * * Number: E.g 1-12 and 2-7
 * * Letters, E.g A-C and B-H
 * * Roman: E.g I-III and IV-XII 
 * 
 * 
 * Examples of page sequences:
 * * 1-8
 * * 1-3, A, B, 4-6
 * * 1-5|6-8
 * * 1-5,i-iv,6-16
 * * Frontpage|1-8
 * * Appendix A - Appendix C
 * * 1-3, !3, 4-16|17, I-VI, 18-20
 */ export class PageSequence {
  /**
	 * Create a new PageSequence.
	 * Return undefined if the sequence is invalid, instead of throwing an error.
	 * @param args 
	 * @returns 
	 */ static create(...args) {
    try {
      return new PageSequence(...args);
    } catch (_e) {
    // ignore
    }
    return undefined;
  }
  validPattern = new RegExp("^section(,section)*$".replaceAll("section", "( *!)?(range(\\|range)*| *\(label(\\|label)+\) *- *\(label(\\|label)+\) *)".replaceAll("range", "label(-label)?".replaceAll("label", "[a-z0-9._ ]+"))), "i");
  sequence;
  indexList = [];
  labelList = [];
  /**
	 * key: label.toLowerCase()
	 */ labelMap = new Map();
  ignoredIndexes = 0;
  constructor(sequence, indexLengthAll){
    if (indexLengthAll && indexLengthAll < 0) throw new Error(`indexLengthAll must be more than 0.`);
    if (!sequence && indexLengthAll) {
      sequence = indexLengthAll > 1 ? `1-${indexLengthAll}` : "1";
    }
    if (!this.validPattern.test(sequence)) throw new Error(`Sequence not valid.`);
    this.sequence = sequence;
    let currentIndex = -1;
    this.sequence.split(",").forEach((section)=>{
      section = section.trim();
      const ignore = section.startsWith("!");
      if (ignore) {
        section = section.substring(1);
      }
      const parts = section.split("|");
      parts.forEach((part, partIndex)=>{
        const labels = [];
        if (part.includes("-")) {
          const [start, end] = part.split("-").map(this.parseLabel);
          [
            start,
            end
          ].forEach((parsedLabel)=>{
            parsedLabel.romanValue = fromRoman(parsedLabel.roman);
          });
          const conditions = {
            stepNum: start.num != undefined && end.num != undefined && start.num < end.num,
            stepRoman: start.romanValue && end.romanValue && start.romanValue < end.romanValue,
            stepAlpha: false
          };
          if (!conditions.stepRoman) {
            [
              start,
              end
            ].forEach((parsedLabel)=>{
              // Did it find something that should have been alpha? Restore it!
              // TODO: Fix for "a_i-b_i" and "i_a-i_b"
              if (parsedLabel.roman?.length == 1) {
                parsedLabel.base = parsedLabel.base.replace("-a-", parsedLabel.alpha ?? "");
                parsedLabel.alpha = parsedLabel.roman;
                parsedLabel.base = parsedLabel.base.replace("-//-", "-a-");
                parsedLabel.roman = undefined;
              }
            });
          }
          conditions.stepAlpha = start.alpha && end.alpha && start.alpha.charCodeAt(0) < end.alpha.charCodeAt(0) || false;
          if (start.base !== end.base) {
            throw new Error(`Unknown range (${part}).`);
          }
          if (Object.values(conditions).filter(Boolean).length > 1) throw new Error(`Illegal multiple range-sequences (${part}).`);
          if (conditions.stepNum) {
            // Range of numbers
            for(let i = start.num; i <= end.num; i++){
              labels.push(start.base.replace("-d-", i.toString()).replace("-a-", start.alpha ?? ""));
            }
          } else if (conditions.stepRoman) {
            // Range of roman
            const lowerCase = start.roman == start.roman?.toLowerCase();
            for(let i = start.romanValue; i <= end.romanValue; i++){
              labels.push(start.base.replace("-//-", "" + toRoman(i, lowerCase)).replace("-a-", start.alpha ?? "").replace("-d-", "" + (start.num ?? "")));
            }
          } else if (conditions.stepAlpha) {
            // Range of letters
            for(let i = start.alpha.charCodeAt(0); i <= end.alpha.charCodeAt(0); i++){
              labels.push(start.base.replace("-d-", "" + (start.num ?? "")).replace("-a-", String.fromCharCode(i)));
            }
          } else throw new Error(`Illegal range-sequence (${part}).`);
        } else {
          labels.push(part.trim());
        }
        labels.forEach((label, labelIndex)=>{
          if (partIndex === 0 || labelIndex > 0) {
            currentIndex++;
            if (!ignore) this.indexList.push(currentIndex);
            else this.ignoredIndexes++;
          }
          if (!ignore) {
            this.labelList.push(label);
            this.labelMap.set(label.toLowerCase(), {
              index: currentIndex,
              label
            });
          }
        });
      });
    });
    if (indexLengthAll != undefined && indexLengthAll != this.getIndexLengthAll()) throw new Error(`indexLengthAll doesn't match length of sequence. ${this.sequence} gives ${this.getIndexLengthAll()} vs ${indexLengthAll}.`);
  }
  parseLabel(part) {
    const result = {
      base: ""
    };
    result.base = part.trim().replace(romanPattern, (roman)=>{
      result.roman = roman;
      result.romanValue = fromRoman(roman);
      return "-//-";
    })// \b[a-z]\b matches with -d-, so do this first!
    .replace(/(?<=^|[^a-z])[a-z](?=[^a-z]|$)/i, (alpha)=>{
      result.alpha = alpha;
      return "-a-";
    }).replace(/\d+/, (num)=>{
      result.num = parseInt(num, 10);
      return "-d-";
    });
    return result;
  }
  /**
	 * Length of PDF.
	 * Includes ignored pages.
	 * Used to verify length of PDF
	 */ getIndexLengthAll() {
    return this.indexList.length + this.ignoredIndexes;
  }
  /**
	 * Length of used PDF-pages.
	 * Excludes ignored pages.
	 */ getIndexLength() {
    return this.indexList.length;
  }
  getIndexList(pages) {
    if (pages) {
      const pageSequence = PageSequence.create(pages);
      if (!pageSequence || !pageSequence.labelList.every((label)=>this.labelMap.has(label.toLowerCase()))) return undefined;
      return pageSequence.labelList.reduce((result, label)=>{
        const index = this.labelMap.get(label.toLowerCase()).index;
        if (index !== result.at(-1)) result.push(index);
        return result;
      }, []);
    } else {
      return this.indexList;
    }
  }
  /**
	 * Number of real pages. Exclude ignored pages.
	 */ getLabelLength() {
    return this.labelList.length;
  }
  getLabelList(pages) {
    if (pages) {
      // Fix case:
      const result = PageSequence.create(pages)?.labelList.map((label)=>this.labelMap.get(label.toLowerCase())?.label);
      if (!result?.every(Boolean)) return undefined;
      return result;
    } else {
      return this.labelList;
    }
  }
}
//# sourceMappingURL=PageSequence.js.map