import fs from "fs";
import path from "path";

const SHEET_ID = "1zIpF_ByFa7wSqervutRKkrto4fSOGxEIfANUkquirJ8";
const GID = "2095029906";
const URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;

async function downloadCSV() {
  console.log("Downloading PSGC data from Google Sheets...");
  try {
    const response = await fetch(URL);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.text();
    const outputPath = path.resolve(__dirname, "../../psgc_data.csv");
    fs.writeFileSync(outputPath, data);
    console.log(`✅ PSGC data downloaded successfully to ${outputPath}`);
  } catch (error) {
    console.error("❌ Error downloading PSGC data:", error);
    process.exit(1);
  }
}

downloadCSV();
