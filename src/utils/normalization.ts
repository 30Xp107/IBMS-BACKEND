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
  
  return str
    .trim()
    .replace(/[\s\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000\uFEFF]+/g, " ") 
    .toLowerCase()
    .split(" ")
    .filter(word => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};
