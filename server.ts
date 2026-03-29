import express from "express";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = (supabaseUrl && supabaseServiceKey) 
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// --- API Routes ---

app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    supabaseConnected: !!supabase,
    urlConfigured: !!supabaseUrl,
    keyConfigured: !!supabaseServiceKey
  });
});

app.get("/api/config", (req, res) => {
  res.json({ 
    supabaseUrl: supabaseUrl || null, 
    supabaseAnonKey: supabaseAnonKey || null 
  });
});

app.get("/api/data", async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

  const roomId = 'private'; 
  try {
    const { data: expenses, error: expError } = await supabase.from('expenses').select('*').eq('room_id', roomId);
    const { data: people, error: pError } = await supabase.from('people').select('*').eq('room_id', roomId);
    const { data: categories, error: cError } = await supabase.from('categories').select('*').eq('room_id', roomId);
    const { data: methods, error: mError } = await supabase.from('payment_methods').select('*').eq('room_id', roomId);

    if (expError || pError || cError || mError) throw new Error("Failed to fetch data from Supabase");

    const mappedExpenses = (expenses || []).map(exp => ({
      ...exp,
      paidBy: exp.payer_id,
      paymentMethod: exp.payment_method,
      receiptUrl: exp.receipt_url, // Maps photo correctly
      payer_id: undefined,
      payment_method: undefined,
      receipt_url: undefined,
      room_id: undefined
    }));

    res.json({ 
      expenses: mappedExpenses, 
      people: (people || []).map(p => ({ ...p, room_id: undefined })), 
      categories: (categories || []).map(c => c.name), 
      paymentMethods: (methods || []).map(m => m.name) 
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/sync", async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

  const { expenses, people, categories, paymentMethods } = req.body;
  const roomId = 'private'; 

  try {
    // 1. Sync People
    if (people && Array.isArray(people)) {
      const mappedPeople = people.map((p: any) => ({
        id: p.id, name: p.name, avatar: p.avatar, room_id: roomId
      }));
      
      if (mappedPeople.length > 0) {
        const { error: pError } = await supabase.from('people').upsert(mappedPeople);
        if (pError) throw new Error(`People Sync Failed: ${pError.message}`);
        
        // FIX: Added single quotes for SQL IN clause
        const currentIds = mappedPeople.map(p => `'${p.id}'`).join(',');
        await supabase.from('people').delete().eq('room_id', roomId).not('id', 'in', `(${currentIds})`);
      } else {
        await supabase.from('people').delete().eq('room_id', roomId);
      }
    }

    // 2. Sync Expenses
    if (expenses && Array.isArray(expenses)) {
      const mappedExpenses = expenses.map((exp: any) => ({
        id: exp.id, description: exp.description, amount: exp.amount, date: exp.date, category: exp.category,
        payer_id: exp.paidBy, payment_method: exp.paymentMethod, remarks: exp.remarks || '', receipt_url: exp.receiptUrl || null,
        splits: exp.splits, room_id: roomId
      }));

      if (mappedExpenses.length > 0) {
        const { error: expError } = await supabase.from('expenses').upsert(mappedExpenses);
        if (expError) throw new Error(`Expenses Sync Failed: ${expError.message}`);
        
        // FIX: Added single quotes for SQL IN clause
        const currentExpIds = mappedExpenses.map(e => `'${e.id}'`).join(',');
        await supabase.from('expenses').delete().eq('room_id', roomId).not('id', 'in', `(${currentExpIds})`);
      } else {
        await supabase.from('expenses').delete().eq('room_id', roomId);
      }
    }

    // 3. Sync Categories
    if (categories && Array.isArray(categories)) {
      const catData = categories.map((name: string) => ({ name, room_id: roomId }));
      if (catData.length > 0) {
        const { error: cError } = await supabase.from('categories').upsert(catData, { onConflict: 'name, room_id' });
        if (cError) {
          await supabase.from('categories').delete().eq('room_id', roomId);
          await supabase.from('categories').insert(catData);
        }
        const escapedNames = categories.map(c => `'${c.replace(/'/g, "''")}'`).join(',');
        await supabase.from('categories').delete().eq('room_id', roomId).not('name', 'in', `(${escapedNames})`);
      } else {
        await supabase.from('categories').delete().eq('room_id', roomId);
      }
    }

    // 4. Sync Payment Methods
    if (paymentMethods && Array.isArray(paymentMethods)) {
      const methodData = paymentMethods.map((name: string) => ({ name, room_id: roomId }));
      if (methodData.length > 0) {
        const { error: mError } = await supabase.from('payment_methods').upsert(methodData, { onConflict: 'name, room_id' });
        if (mError) {
          await supabase.from('payment_methods').delete().eq('room_id', roomId);
          await supabase.from('payment_methods').insert(methodData);
        }
        const escapedMethods = paymentMethods.map(m => `'${m.replace(/'/g, "''")}'`).join(',');
        await supabase.from('payment_methods').delete().eq('room_id', roomId).not('name', 'in', `(${escapedMethods})`);
      } else {
        await supabase.from('payment_methods').delete().eq('room_id', roomId);
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unknown sync error" });
  }
});

// === VERCEL FIX ===
// Do not run local app.listen or Vite when deployed on Vercel
if (process.env.VERCEL !== "1") {
  async function startServer() {
    if (process.env.NODE_ENV !== "production") {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      app.use(express.static("dist"));
      app.get("*", (req, res) => {
        res.sendFile("index.html", { root: "dist" });
      });
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
  startServer();
}

export default app;