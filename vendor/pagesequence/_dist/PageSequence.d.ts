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
 */ export declare class PageSequence {
  /**
	 * Create a new PageSequence.
	 * Return undefined if the sequence is invalid, instead of throwing an error.
	 * @param args 
	 * @returns 
	 */ public static create(...args: ConstructorParameters<typeof PageSequence>): PageSequence | undefined;
  private validPattern: any;
  private sequence: any;
  private indexList: any;
  private labelList: any;
  /**
	 * key: label.toLowerCase()
	 */ private labelMap: any;
  private ignoredIndexes: any;
  constructor(sequence: string, indexLengthAll?: number);
  private parseLabel: any;
  /**
	 * Length of PDF.
	 * Includes ignored pages.
	 * Used to verify length of PDF
	 */ public getIndexLengthAll(): number;
  /**
	 * Length of used PDF-pages.
	 * Excludes ignored pages.
	 */ public getIndexLength(): number;
  /**
	 * Returns an array with index specified page labels.
	 * If pages is not specified, index for every page in the PDF.
	 * Excludes ignored pages.
	 */ public getIndexList(): number[];
  public getIndexList(pages: string): number[] | undefined;
  /**
	 * Number of real pages. Exclude ignored pages.
	 */ public getLabelLength(): number;
  /**
	 * An array with label for every page.
	 * Excludes ignored pages.
	 */ public getLabelList(): string[];
  public getLabelList(pages?: string): string[] | undefined;
}
//# sourceMappingURL=PageSequence.d.ts.map