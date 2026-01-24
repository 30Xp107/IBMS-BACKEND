import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

console.log("Current MONGODB_URI in process.env:", process.env.MONGODB_URI);
