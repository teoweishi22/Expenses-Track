import express from "express";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log("--- Supabase Diagnostics ---");
console.log("URL detected:", !!supabaseUrl);
console.log("Key detected:", !!supabaseServiceKey);
console.log("Environment Keys found:", Object.keys(process.env).filter(k => k.includes('SUPABASE')));
if (!supabaseUrl || !supabaseServiceKey) {
  console.log("Missing variables. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in AI Studio.");
}
console.log("----------------------------");

const supabase = (supabaseUrl && supabaseServiceKey) 
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

if (supabase) {
  console.log("✅ Supabase client initialized successfully.");
} else {
  console.error("❌ Supabase client failed to initialize. Please ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your environment variables.");
}

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", supabaseConnected: !!supabase });
});

// Get all data (expenses, people, categories, paymentMethods)
app.get("/api/data", async (req, res) => {
  if (!supabase) {
    console.error("Supabase client not initialized. Check environment variables.");
    return res.status(500).json({ error: "Supabase not configured" });
  }

  try {
    const { data: expenses, error: expError } = await supabase.from('expenses').select('*');
    const { data: people, error: pError } = await supabase.from('people').select('*');
    const { data: categories, error: cError } = await supabase.from('categories').select('*');
    const { data: methods, error: mError } = await supabase.from('payment_methods').select('*');

    if (expError || pError || cError || mError) {
      console.error("Supabase Fetch Error:", { expError, pError, cError, mError });
      throw new Error("Failed to fetch data from Supabase");
    }

    // Map database columns back to frontend interface
    const mappedExpenses = (expenses || []).map(exp => ({
      ...exp,
      paidBy: exp.payer_id,
      paymentMethod: exp.payment_method,
      // Remove database-only fields to keep frontend clean if necessary
      payer_id: undefined,
      payment_method: undefined
    }));

    res.json({ 
      expenses: mappedExpenses, 
      people, 
      categories: categories.map(c => c.name), 
      paymentMethods: methods.map(m => m.name) 
    });
  } catch (error: any) {
    console.error("API Data Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get notes from Supabase
app.get("/api/notes", async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

  try {
    const { data: notes, error } = await supabase.from("notes").select("*").order('created_at', { ascending: false });
    if (error) throw error;
    res.json(notes);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new note
app.post("/api/notes", async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

  const { title, content } = req.body;
  try {
    const { data, error } = await supabase.from("notes").insert([{ title, content }]).select();
    if (error) throw error;
    res.json(data[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Sync data
app.post("/api/sync", async (req, res) => {
  if (!supabase) {
    console.error("Supabase client not initialized for sync.");
    return res.status(500).json({ error: "Supabase not configured" });
  }

  const { expenses, people, categories, paymentMethods } = req.body;

  try {
    if (people && people.length > 0) {
      const { error: pError } = await supabase.from('people').upsert(people);
      if (pError) throw pError;
    }

    if (expenses && expenses.length > 0) {
      // Map frontend fields to database columns
      const mappedExpenses = expenses.map((exp: any) => ({
        id: exp.id,
        description: exp.description,
        amount: exp.amount,
        date: exp.date,
        category: exp.category,
        payer_id: exp.paidBy,
        payment_method: exp.paymentMethod,
        remarks: exp.remarks,
        receipt_url: exp.receiptUrl,
        splits: exp.splits
      }));
      const { error: expError } = await supabase.from('expenses').upsert(mappedExpenses);
      if (expError) throw expError;
    }

    if (categories && categories.length > 0) {
      const catData = categories.map((name: string) => ({ name }));
      const { error: cError } = await supabase.from('categories').upsert(catData, { onConflict: 'name' });
      if (cError) throw cError;
    }

    if (paymentMethods && paymentMethods.length > 0) {
      const methodData = paymentMethods.map((name: string) => ({ name }));
      const { error: mError } = await supabase.from('payment_methods').upsert(methodData, { onConflict: 'name' });
      if (mError) throw mError;
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Sync Error Details:", error);
    res.status(500).json({ error: error.message || "Unknown sync error" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
