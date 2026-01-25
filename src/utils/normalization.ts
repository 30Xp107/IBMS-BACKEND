/**
 * Normalizes an area name (province, municipality, barangay) by:
 * 1. Trimming whitespace
 * 2. Collapsing multiple spaces into one
 * 3. Handling special whitespace characters
 * 4. Converting to Title Case
 * 
 * @param str The string to normalize
 * @returns The normalized string
 */
export const normalizeArea = (str: string | undefined | null): string => {
  if (!str) return "Unknown";
  
  const romanNumerals = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii"];
  const acronyms = ["ncr", "armm", "barmm", "car", "nir", "4ps", "psgc", "ibm", "dswd"];
  
  return str
    .trim()
    .replace(/[\s\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000\uFEFF]+/g, " ") 
    .toLowerCase()
    .split(" ")
    .filter(word => word.length > 0)
    .map((word) => {
      // Handle words in parentheses like (NIR) or (VI)
      const match = word.match(/^(\()(.+)(\))$/);
      if (match) {
        const inner = match[2];
        if (romanNumerals.includes(inner) || acronyms.includes(inner)) {
          return `(${inner.toUpperCase()})`;
        }
        return `(${inner.charAt(0).toUpperCase() + inner.slice(1)})`;
      }

      if (romanNumerals.includes(word) || acronyms.includes(word)) {
        return word.toUpperCase();
      }
      
      // Handle cases like IV-A
      if (word.includes("-")) {
        return word.split("-").map(part => {
          if (romanNumerals.includes(part) || acronyms.includes(part)) {
            return part.toUpperCase();
          }
          return part.charAt(0).toUpperCase() + part.slice(1);
        }).join("-");
      }

      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
};
