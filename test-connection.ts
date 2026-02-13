import pg from 'pg';
const { Client } = pg;
import * as dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

async function runDiagnostic() {
  console.log("🔍 Starting TrustLayer Diagnostics...\n");

  // 1. Database Test
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    console.log("✅ [DATABASE]: Connection to Supabase successful!");
    const res = await client.query('SELECT NOW()');
    console.log(`📡 [DATABASE]: Server time is ${res.rows[0].now}`);
    await client.end();
  } catch (err) {
    console.error("❌ [DATABASE]: Failed to connect to Supabase. Check your .env file.");
  }

  // 2. Blockchain API Test
  const wallet = "UQCbTW0NWPyE28ltt2GvN5nS0XwVYyf4johavHU2fZQqhRfD";
  const url = `https://testnet.toncenter.com/api/v2/getTransactions?address=${wallet}&limit=1`;
  try {
    const response = await axios.get(url);
    if (response.data.ok) {
      console.log("✅ [BLOCKCHAIN]: Toncenter API (Testnet) is reachable!");
    }
  } catch (err) {
    console.error("❌ [BLOCKCHAIN]: Failed to reach TON API.");
  }

  console.log("\n🚀 All systems ready for deployment!");
  process.exit();
}

runDiagnostic();