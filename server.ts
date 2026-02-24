import express from "express";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = (supabaseUrl && supabaseServiceKey) 
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", supabaseConnected: !!supabase });
});

// Get all data (expenses, people, categories, paymentMethods)
app.get("/api/data", async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

  try {
    const { data: expenses, error: expError } = await supabase.from('expenses').select('*');
    const { data: people, error: pError } = await supabase.from('people').select('*');
    const { data: categories, error: cError } = await supabase.from('categories').select('*');
    const { data: methods, error: mError } = await supabase.from('payment_methods').select('*');

    if (expError || pError || cError || mError) {
      throw new Error("Failed to fetch data from Supabase");
    }

    res.json({ expenses, people, categories: categories.map(c => c.name), paymentMethods: methods.map(m => m.name) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get notes from Supabase
app.get("/api/notes", async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

  try {
    const { data: notes, error } = await supabase.from("notes").select("*");
    if (error) throw error;
    res.json(notes);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Sync data
app.post("/api/sync", async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

  const { expenses, people, categories, paymentMethods } = req.body;

  try {
    // Simple sync: delete and re-insert (or upsert if you have IDs)
    // For a robust implementation, we'd use upserts.
    
    if (expenses) await supabase.from('expenses').upsert(expenses);
    if (people) await supabase.from('people').upsert(people);
    if (categories) {
      const catData = categories.map((name: string) => ({ name }));
      await supabase.from('categories').upsert(catData, { onConflict: 'name' });
    }
    if (paymentMethods) {
      const methodData = paymentMethods.map((name: string) => ({ name }));
      await supabase.from('payment_methods').upsert(methodData, { onConflict: 'name' });
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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
