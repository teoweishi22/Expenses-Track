import express from "express";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

console.log("--- Supabase Diagnostics ---");
console.log("URL detected:", !!supabaseUrl);
console.log("Service Key detected:", !!supabaseServiceKey);
console.log("Anon Key detected:", !!supabaseAnonKey);
console.log("Environment Keys found:", Object.keys(process.env).filter(k => k.includes('SUPABASE')));

if (!supabaseUrl || !supabaseServiceKey) {
  console.log("CRITICAL: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}
console.log("----------------------------");

const supabase = (supabaseUrl && supabaseServiceKey) 
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

if (supabase) {
  console.log("✅ Supabase client initialized with Service Role Key.");
} else {
  console.error("❌ Supabase client failed to initialize.");
}

// API Routes
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

// Get all data (expenses, people, categories, paymentMethods)
app.get("/api/data", async (req, res) => {
  if (!supabase) {
    console.error("Supabase client not initialized. Check environment variables.");
    return res.status(500).json({ error: "Supabase not configured" });
  }

  const roomId = 'private'; // Hardcoded for private use
  try {
    const { data: expenses, error: expError } = await supabase.from('expenses').select('*').eq('room_id', roomId);
    const { data: people, error: pError } = await supabase.from('people').select('*').eq('room_id', roomId);
    const { data: categories, error: cError } = await supabase.from('categories').select('*').eq('room_id', roomId);
    const { data: methods, error: mError } = await supabase.from('payment_methods').select('*').eq('room_id', roomId);

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
      payment_method: undefined,
      room_id: undefined
    }));

    res.json({ 
      expenses: mappedExpenses, 
      people: (people || []).map(p => ({ ...p, room_id: undefined })), 
      categories: (categories || []).map(c => c.name), 
      paymentMethods: (methods || []).map(m => m.name) 
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
  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

  const { expenses, people, categories, paymentMethods } = req.body;
  const roomId = 'private'; 

  console.log(`--- Syncing Data for Room: ${roomId} ---`);

  try {
    // 1. Sync People
    if (people) {
      const mappedPeople = people.map((p: any) => ({ ...p, room_id: roomId }));
      if (mappedPeople.length > 0) {
        const { error: pError } = await supabase.from('people').upsert(mappedPeople);
        if (pError) throw pError;
        
        const currentIds = mappedPeople.map(p => p.id);
        await supabase.from('people').delete().eq('room_id', roomId).not('id', 'in', `(${currentIds.join(',')})`);
      } else {
        await supabase.from('people').delete().eq('room_id', roomId);
      }
    }

    // 2. Sync Expenses
    if (expenses) {
      const mappedExpenses = expenses.map((exp: any) => ({
        id: exp.id,
        description: exp.description,
        amount: exp.amount,
        date: exp.date,
        category: exp.category,
        payer_id: exp.paidBy,
        payment_method: exp.paymentMethod,
        remarks: exp.remarks || '',
        receipt_url: exp.receiptUrl || null,
        splits: exp.splits,
        room_id: roomId
      }));

      if (mappedExpenses.length > 0) {
        const { error: expError } = await supabase.from('expenses').upsert(mappedExpenses);
        if (expError) throw expError;
        
        const currentIds = mappedExpenses.map(e => e.id);
        await supabase.from('expenses').delete().eq('room_id', roomId).not('id', 'in', `(${currentIds.join(',')})`);
      } else {
        await supabase.from('expenses').delete().eq('room_id', roomId);
      }
    }

    // 3. Sync Categories
    if (categories) {
      const catData = categories.map((name: string) => ({ name, room_id: roomId }));
      if (catData.length > 0) {
        const { error: cError } = await supabase.from('categories').upsert(catData, { onConflict: 'name' });
        if (cError) {
          console.warn("Upsert categories with 'name' failed, trying 'name, room_id'", cError.message);
          const { error: cError2 } = await supabase.from('categories').upsert(catData, { onConflict: 'name, room_id' });
          if (cError2) {
            console.warn("Upsert categories failed, falling back to delete/insert");
            await supabase.from('categories').delete().eq('room_id', roomId);
            const { error: cError3 } = await supabase.from('categories').insert(catData);
            if (cError3) throw cError3;
          }
        }
        
        const escapedNames = categories.map(c => `'${c.replace(/'/g, "''")}'`).join(',');
        await supabase.from('categories').delete().eq('room_id', roomId).not('name', 'in', `(${escapedNames})`);
      } else {
        await supabase.from('categories').delete().eq('room_id', roomId);
      }
    }

    // 4. Sync Payment Methods
    if (paymentMethods) {
      const methodData = paymentMethods.map((name: string) => ({ name, room_id: roomId }));
      if (methodData.length > 0) {
        const { error: mError } = await supabase.from('payment_methods').upsert(methodData, { onConflict: 'name' });
        if (mError) {
          console.warn("Upsert methods with 'name' failed, trying 'name, room_id'", mError.message);
          const { error: mError2 } = await supabase.from('payment_methods').upsert(methodData, { onConflict: 'name, room_id' });
          if (mError2) {
            console.warn("Upsert methods failed, falling back to delete/insert");
            await supabase.from('payment_methods').delete().eq('room_id', roomId);
            const { error: mError3 } = await supabase.from('payment_methods').insert(methodData);
            if (mError3) throw mError3;
          }
        }
        
        const escapedMethods = paymentMethods.map(m => `'${m.replace(/'/g, "''")}'`).join(',');
        await supabase.from('payment_methods').delete().eq('room_id', roomId).not('name', 'in', `(${escapedMethods})`);
      } else {
        await supabase.from('payment_methods').delete().eq('room_id', roomId);
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Sync Error Details:", error);
    res.status(500).json({ error: error.message || "Unknown sync error" });
  }
});

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

  // Only listen if not running on Vercel
  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startServer();

export default app;
