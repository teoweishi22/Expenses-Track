
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { compressImage } from './src/utils/image';
import Layout from './components/Layout';
import ExpenseForm from './components/ExpenseForm';
import Charts from './components/Charts';
import Notes from './components/Notes';
import { Expense, Person, Balance } from './types';
import { getFinancialInsights } from './services/geminiService';
import { CATEGORIES as INITIAL_CATEGORIES } from './constants';

const INITIAL_PEOPLE: Person[] = [
  { id: 'me', name: 'You', avatar: 'https://picsum.photos/seed/me/100' },
  { id: 'p1', name: 'Alice', avatar: 'https://picsum.photos/seed/p1/100' },
  { id: 'p2', name: 'Bob', avatar: 'https://picsum.photos/seed/p2/100' }
];

const INITIAL_PAYMENT_METHODS = ['Cash', 'eWallet', 'Credit Card'];
const CURRENCY = 'RM';
const SYNC_INTERVAL = 60000; // Poll every 60 seconds for sync

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'expenses' | 'people' | 'notes'>('dashboard');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [people, setPeople] = useState<Person[]>(INITIAL_PEOPLE);
  const [categories, setCategories] = useState<string[]>(INITIAL_CATEGORIES);
  const [paymentMethods, setPaymentMethods] = useState<string[]>(INITIAL_PAYMENT_METHODS);
  const [isAddingExpense, setIsAddingExpense] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [insights, setInsights] = useState<string>('Recording your first expense...');
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [zoomedReceipt, setZoomedReceipt] = useState<string | null>(null);
  const [configRequired, setConfigRequired] = useState(false);
  
  // Ref to track if update is from remote to prevent sync loops
  const isRemoteUpdate = useRef(false);
  
  // Export Date Range State
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper: Get Current Cycle Range (11th to 10th)
  const getCycleRange = useCallback(() => {
    const now = new Date();
    let startMonth = now.getMonth();
    let startYear = now.getFullYear();
    
    if (now.getDate() < 11) {
      startMonth -= 1;
      if (startMonth < 0) {
        startMonth = 11;
        startYear -= 1;
      }
    }
    
    const start = new Date(startYear, startMonth, 11, 0, 0, 0);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    end.setDate(10);
    end.setHours(23, 59, 59, 999);
    
    return { start, end };
  }, []);

  const getRoomId = () => window.location.hash.replace('#room=', '');
  
  const syncToCloud = useCallback(async (data: any) => {
    if (isRemoteUpdate.current) return;
    
    setIsSyncing(true);
    try {
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.indexOf("application/json") !== -1) {
        if (!response.ok) {
          let errData;
          try {
            errData = await response.json();
          } catch (jsonError) {
            // Fallback if JSON parsing fails even with correct content-type
            const text = await response.text();
            throw new Error(text || "Sync failed (malformed JSON)");
          }
          if (errData.error === "Supabase not configured") setConfigRequired(true);
          throw new Error(errData.error || "Sync failed");
        }
      } else {
        const text = await response.text();
        if (!response.ok) throw new Error(text || "Sync failed (non-JSON response)");
      }
      
      setConfigRequired(false);
    } catch (e: any) {
      console.error("Sync Error:", e.message);
    } finally {
      setTimeout(() => setIsSyncing(false), 1000);
    }
  }, []);

  const loadFromCloud = useCallback(async () => {
    try {
      const response = await fetch('/api/data');
      
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.indexOf("application/json") !== -1) {
        if (!response.ok) {
          let errData;
          try {
            errData = await response.json();
          } catch (jsonError) {
             const text = await response.text();
             throw new Error(text || "Load failed (malformed JSON)");
          }
          if (errData.error === "Supabase not configured") setConfigRequired(true);
          throw new Error(errData.error || "Load failed");
        }
        
        let parsed;
        try {
          parsed = await response.json();
        } catch (jsonError) {
           const text = await response.text();
           console.warn("Received malformed JSON from /api/data:", text);
           throw new Error("Load failed (malformed JSON)");
        }
        
        setConfigRequired(false);
        
        isRemoteUpdate.current = true;
        
        // If the database is completely empty (new user), don't overwrite the initial state
        const isDbEmpty = (parsed.expenses?.length === 0) && 
                          (parsed.people?.length === 0) && 
                          (parsed.categories?.length === 0) && 
                          (parsed.paymentMethods?.length === 0);
                          
        if (!isDbEmpty) {
          setExpenses(parsed.expenses || []);
          setPeople(parsed.people || []);
          setCategories(parsed.categories || []);
          setPaymentMethods(parsed.paymentMethods || []);
        } else {
          // Force a sync of the initial local state to the empty database
          isRemoteUpdate.current = false;
        }
        
        // Reset flag after state updates are processed
        setTimeout(() => {
          isRemoteUpdate.current = false;
        }, 100);
      } else {
        const text = await response.text();
        if (!response.ok) throw new Error(text || "Load failed (non-JSON response)");
        console.warn("Received non-JSON response from /api/data:", text);
      }
    } catch (e: any) {
      console.error("Load Error:", e.message);
    }
  }, []);

  useEffect(() => {
    const savedExpenses = localStorage.getItem('expenses');
    const savedPeople = localStorage.getItem('people');
    const savedCategories = localStorage.getItem('categories');
    const savedMethods = localStorage.getItem('paymentMethods');
    if (savedExpenses) setExpenses(JSON.parse(savedExpenses));
    if (savedPeople) setPeople(JSON.parse(savedPeople));
    if (savedCategories) setCategories(JSON.parse(savedCategories));
    if (savedMethods) setPaymentMethods(JSON.parse(savedMethods));

    loadFromCloud();

    const interval = setInterval(() => {
      loadFromCloud();
    }, SYNC_INTERVAL);

    return () => clearInterval(interval);
  }, [loadFromCloud]);

  useEffect(() => {
    const data = { expenses, people, categories, paymentMethods };
    localStorage.setItem('expenses', JSON.stringify(expenses));
    localStorage.setItem('people', JSON.stringify(people));
    localStorage.setItem('categories', JSON.stringify(categories));
    localStorage.setItem('paymentMethods', JSON.stringify(paymentMethods));
    
    if (isRemoteUpdate.current) return;

    const timeoutId = setTimeout(() => {
      syncToCloud(data);
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [expenses, people, categories, paymentMethods, syncToCloud]);

  const fetchInsights = useCallback(async () => {
    if (expenses.length > 0) {
      setIsLoadingInsights(true);
      const text = await getFinancialInsights(expenses);
      setInsights(text);
      setIsLoadingInsights(false);
    }
  }, [expenses]);

  useEffect(() => {
    fetchInsights();
  }, [expenses.length, fetchInsights]);

  const handleAddExpense = (newExpense: Omit<Expense, 'id'>) => {
    const expense = { ...newExpense, id: uuidv4() };
    setExpenses(prev => [...prev, expense]);
    setIsAddingExpense(false);
  };

  const handleUpdateExpense = (id: string, updatedData: Omit<Expense, 'id'>) => {
    setExpenses(prev => prev.map(exp => exp.id === id ? { ...updatedData, id } : exp));
    setEditingExpense(null);
  };

  const handleDeleteExpense = (id: string) => {
    setExpenses(prev => prev.filter(exp => exp.id !== id));
    setEditingExpense(null);
  };

  const handleAddPerson = () => {
    const name = prompt("Enter person's name:");
    if (!name) return;
    const newPerson: Person = {
      id: uuidv4(),
      name,
      avatar: `https://picsum.photos/seed/${name}/100`
    };
    setPeople(prev => [...prev, newPerson]);
  };

  const handleUpdatePerson = (id: string, updates: Partial<Person>) => {
    setPeople(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    setEditingPerson(null);
  };

  const handleDeletePerson = (id: string) => {
    if (id === 'me') {
      alert("You cannot delete yourself!");
      return;
    }
    if (confirm("Are you sure? This will remove this person from the list. History involving them will remain.")) {
      setPeople(prev => prev.filter(p => p.id !== id));
    }
  };

  const handleAddCategory = () => {
    const name = prompt("Enter new category name:");
    if (name && !categories.includes(name)) {
      setCategories(prev => [...prev, name]);
    }
  };

  const handleEditCategory = (oldName: string) => {
    const newName = prompt("Rename category:", oldName);
    if (newName && newName !== oldName && !categories.includes(newName)) {
      setCategories(prev => prev.map(c => c === oldName ? newName : c));
      // Update historical expenses
      setExpenses(prev => prev.map(exp => exp.category === oldName ? { ...exp, category: newName } : exp));
    }
  };

  const handleDeleteCategory = (cat: string) => {
    if (categories.length <= 1) {
      alert("You must have at least one category.");
      return;
    }
    if (confirm(`Delete category "${cat}"?`)) {
      setCategories(prev => prev.filter(c => c !== cat));
    }
  };

  const handleAddPaymentMethod = () => {
    const name = prompt("Enter payment method or merchant (e.g., GrabPay, TNG, Visa):");
    if (name && !paymentMethods.includes(name)) {
      setPaymentMethods(prev => [...prev, name]);
    }
  };

  const handleDeletePaymentMethod = (method: string) => {
    if (paymentMethods.length <= 1) {
      alert("You must have at least one payment method.");
      return;
    }
    if (confirm(`Delete payment method "${method}"?`)) {
      setPaymentMethods(prev => prev.filter(m => m !== method));
    }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && editingPerson) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const compressed = await compressImage(reader.result as string);
        handleUpdatePerson(editingPerson.id, { avatar: compressed });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSettleUp = (personId: string, maxAmount: number) => {
    const personName = people.find(p => p.id === personId)?.name || 'Someone';
    const input = prompt(`Enter payment amount from ${personName} (Max ${CURRENCY} ${maxAmount.toFixed(2)}):`, maxAmount.toFixed(2));
    
    if (input === null) return;
    const amount = parseFloat(input);

    if (isNaN(amount) || amount <= 0) {
      alert("Please enter a valid amount.");
      return;
    }

    const settleExpense: Omit<Expense, 'id'> = {
      description: `Payment from ${personName}`,
      amount: amount,
      date: new Date().toISOString(),
      category: 'Settlement', 
      paymentMethod: paymentMethods[0],
      paidBy: personId, 
      splits: [{ personId: 'me', amount: amount }]
    };
    handleAddExpense(settleExpense);
  };

  const exportExpensesToCSV = useCallback((data: Expense[], filenamePrefix: string, start?: string, end?: string) => {
    let finalData = data;
    if (start || end) {
      finalData = data.filter(exp => {
        const expDate = new Date(exp.date).getTime();
        const startBound = start ? new Date(start).getTime() : -Infinity;
        const endBound = end ? new Date(end).setHours(23,59,59,999) : Infinity;
        return expDate >= startBound && expDate <= endBound;
      });
    }

    if (finalData.length === 0) {
      alert("No expenses found in this range to export.");
      return;
    }

    const csvRows = [
      ['Date', 'Description', 'Category', 'Payment Method', `Total Amount (${CURRENCY})`, 'Share Amount', 'Paid By', 'Splits'].join(',')
    ];

    finalData.forEach(exp => {
      const dateStr = new Date(exp.date).toLocaleDateString();
      const paidByName = people.find(p => p.id === exp.paidBy)?.name || 'Deleted User';
      const splitsNames = exp.splits.map(s => people.find(p => p.id === s.personId)?.name || 'Deleted User').join('; ');
      const shareAmt = personFilter ? (exp.splits.find(s => s.personId === personFilter)?.amount || 0) : exp.amount;

      csvRows.push([
        `"${dateStr}"`,
        `"${exp.description}"`,
        `"${exp.category}"`,
        `"${exp.paymentMethod || 'N/A'}"`,
        exp.amount.toFixed(2),
        shareAmt.toFixed(2),
        `"${paidByName}"`,
        `"${splitsNames}"`
      ].join(','));
    });

    const csvContent = "data:text/csv;charset=utf-8," + csvRows.join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const dateStamp = new Date().toISOString().split('T')[0];
    link.setAttribute("download", `${filenamePrefix}_${dateStamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [people, personFilter]);

  const downloadReceipt = (url: string, description: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `receipt_${description.replace(/\s+/g, '_')}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportExpensesToExcel = useCallback(async (data: Expense[], filenamePrefix: string, start?: string, end?: string) => {
    let finalData = data;
    if (start || end) {
      finalData = data.filter(exp => {
        const expDate = new Date(exp.date).getTime();
        const startBound = start ? new Date(start).getTime() : -Infinity;
        const endBound = end ? new Date(end).setHours(23,59,59,999) : Infinity;
        return expDate >= startBound && expDate <= endBound;
      });
    }

    if (finalData.length === 0) {
      alert("No expenses found in this range to export.");
      return;
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Expenses');

    worksheet.columns = [
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Description', key: 'description', width: 30 },
      { header: 'Category', key: 'category', width: 15 },
      { header: 'Payment Method', key: 'paymentMethod', width: 15 },
      { header: `Total Amount (${CURRENCY})`, key: 'amount', width: 15 },
      { header: 'Share Amount', key: 'share', width: 15 },
      { header: 'Paid By', key: 'paidBy', width: 15 },
      { header: 'Splits', key: 'splits', width: 30 },
      { header: 'Type', key: 'type', width: 15 }
    ];

    // Style header
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    finalData.forEach(exp => {
      const isSettlement = exp.category === 'Settlement';
      const paidByName = people.find(p => p.id === exp.paidBy)?.name || 'Deleted User';
      const splitsNames = exp.splits.map(s => people.find(p => p.id === s.personId)?.name || 'Deleted User').join(', ');
      const shareAmt = personFilter ? (exp.splits.find(s => s.personId === personFilter)?.amount || 0) : exp.amount;

      const row = worksheet.addRow({
        date: new Date(exp.date).toLocaleDateString(),
        description: exp.description,
        category: exp.category,
        paymentMethod: exp.paymentMethod || 'N/A',
        amount: exp.amount,
        share: shareAmt,
        paidBy: paidByName,
        splits: splitsNames,
        type: isSettlement ? 'REPAYMENT' : 'EXPENSE'
      });

      if (isSettlement) {
        row.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD1FAE5' } // emerald-100
          };
          cell.font = { color: { argb: 'FFFF0000' } }; // Red color font
        });
      }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const dateStamp = new Date().toISOString().split('T')[0];
    saveAs(blob, `${filenamePrefix}_${dateStamp}.xlsx`);
  }, [people, personFilter]);

  const filteredExpenses = useMemo(() => {
    let results = [...expenses].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    if (personFilter) {
      results = results.filter(exp => 
        exp.paidBy === personFilter || 
        exp.splits.some(s => s.personId === personFilter)
      );
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      results = results.filter(exp => 
        exp.description.toLowerCase().includes(query) || 
        exp.category.toLowerCase().includes(query) ||
        exp.paymentMethod.toLowerCase().includes(query)
      );
    }
    return results;
  }, [expenses, personFilter, searchQuery]);

  const totalMyExpensesInCycle = useMemo(() => {
    const { start, end } = getCycleRange();
    return expenses.reduce((acc, exp) => {
      if (exp.category === 'Settlement') return acc;
      const expDate = new Date(exp.date);
      if (expDate >= start && expDate <= end) {
        const myShare = exp.splits.find(s => s.personId === 'me')?.amount || 0;
        return acc + myShare;
      }
      return acc;
    }, 0);
  }, [expenses, getCycleRange]);

  const youAreOwedTotal = expenses.reduce((acc, exp) => {
    if (exp.paidBy === 'me') {
      const othersShare = exp.splits.filter(s => s.personId !== 'me').reduce((sum, s) => sum + s.amount, 0);
      return acc + othersShare;
    }
    return acc;
  }, 0);

  const youOweTotal = expenses.reduce((acc, exp) => {
    if (exp.paidBy !== 'me') {
      const myShare = exp.splits.find(s => s.personId === 'me')?.amount || 0;
      return acc + myShare;
    }
    return acc;
  }, 0);

  const getNetBalanceWithMe = (personId: string) => {
    if (personId === 'me') return 0;
    const theyOweMe = expenses.reduce((acc, exp) => {
      if (exp.paidBy === 'me') return acc + (exp.splits.find(s => s.personId === personId)?.amount || 0);
      return acc;
    }, 0);
    const iOweThem = expenses.reduce((acc, exp) => {
      if (exp.paidBy === personId) return acc + (exp.splits.find(s => s.personId === 'me')?.amount || 0);
      return acc;
    }, 0);
    return theyOweMe - iOweThem;
  };

  const balances = useMemo(() => {
    return people.map(person => {
      let totalSpent = 0;
      expenses.forEach(expense => {
        if (expense.category === 'Settlement') return;
        const split = expense.splits.find(s => s.personId === person.id);
        if (split) totalSpent += split.amount;
      });
      return { personId: person.id, totalSpent };
    });
  }, [people, expenses]);

  const generateSyncLink = () => {
    const roomId = uuidv4().substring(0, 8);
    const link = `${window.location.origin}${window.location.pathname}#room=${roomId}`;
    prompt("Share this link with your group for live updates:", link);
    window.location.hash = `room=${roomId}`;
  };

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab}>
      {configRequired && (
        <div className="mb-6 p-6 bg-amber-50 border border-amber-200 rounded-3xl animate-in fade-in slide-in-from-top duration-500">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 shrink-0">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <div className="space-y-2">
              <h3 className="font-bold text-amber-900">Supabase Configuration Required</h3>
              <p className="text-sm text-amber-800 leading-relaxed">
                Cloud sync is currently disabled. To enable it, please add your Supabase credentials to the <strong>AI Studio Environment Variables</strong>:
              </p>
              <div className="bg-white/50 p-3 rounded-xl border border-amber-100 font-mono text-xs space-y-1">
                <p>SUPABASE_URL=https://eefjyoxdkunltjrnwqko.supabase.co</p>
                <p>SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...</p>
              </div>
              <p className="text-[10px] text-amber-600 italic">The app will automatically reconnect once these variables are set.</p>
            </div>
          </div>
        </div>
      )}
      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        accept="image/*" 
        onChange={handleAvatarChange} 
      />

      {activeTab === 'dashboard' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="flex justify-between items-center bg-white px-6 py-3 rounded-2xl border border-slate-100 shadow-sm">
             <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${getRoomId() ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`}></div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  {getRoomId() ? `Sync Active: Room ${getRoomId()}` : 'Offline Mode (Local Only)'}
                </span>
             </div>
             {!getRoomId() && (
               <button onClick={generateSyncLink} className="text-[10px] font-bold text-indigo-600 hover:underline">Enable Cloud Sync</button>
             )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-indigo-600 p-6 rounded-3xl shadow-xl shadow-indigo-100 text-white relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                <svg className="w-16 h-16" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>
              </div>
              <p className="text-indigo-100 text-[10px] font-bold uppercase tracking-wider mb-1">My Expenses (Monthly Cycle)</p>
              <h3 className="text-3xl font-bold">{CURRENCY} {totalMyExpensesInCycle.toFixed(2)}</h3>
              <p className="text-[9px] text-indigo-200 mt-2 font-medium">Resetting on the 11th</p>
            </div>
            <div className="bg-emerald-500 p-6 rounded-3xl shadow-xl shadow-emerald-50 text-white relative overflow-hidden">
              <p className="text-emerald-50 text-[10px] font-bold uppercase tracking-wider mb-1">You are owed</p>
              <h3 className="text-3xl font-bold">{CURRENCY} {youAreOwedTotal.toFixed(2)}</h3>
            </div>
            <div className="bg-rose-500 p-6 rounded-3xl shadow-xl shadow-rose-50 text-white relative overflow-hidden">
              <p className="text-rose-50 text-[10px] font-bold uppercase tracking-wider mb-1">You owe</p>
              <h3 className="text-3xl font-bold">{CURRENCY} {youOweTotal.toFixed(2)}</h3>
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl shadow-sm border border-indigo-100 flex items-start gap-4">
            <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center flex-shrink-0 text-indigo-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor"><path d="M11.644 1.59a.75.75 0 01.712 0l9.75 5.25a.75.75 0 010 1.32l-9.75 5.25a.75.75 0 01-.712 0l-9.75-5.25a.75.75 0 010-1.32l9.75-5.25z" /><path d="M3.265 10.602l7.635 4.111a.75.75 0 00.712 0l7.635-4.11a.75.75 0 01.701 1.324l-8 4.308a.75.75 0 01-.712 0l-8-4.308a.75.75 0 01.701-1.325z" /></svg>
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-bold text-slate-900 mb-1">AI Financial Coach</h4>
              {isLoadingInsights ? (
                <div className="flex items-center gap-2 text-slate-400">
                  <div className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                  <span className="text-sm italic text-xs">Processing activity...</span>
                </div>
              ) : (
                <div className="text-slate-600 text-sm leading-relaxed whitespace-pre-line">{insights}</div>
              )}
            </div>
          </div>

          <Charts expenses={expenses} />

          <div className="flex justify-between items-center">
            <h3 className="text-xl font-bold text-slate-800">Recent Activity</h3>
            <button onClick={() => setIsAddingExpense(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100">+ New</button>
          </div>

          <div className="space-y-3">
            {expenses.slice(-5).reverse().map(exp => {
              const isSettlement = exp.category === 'Settlement';
              const payer = people.find(p => p.id === exp.paidBy);
              return (
                <div key={exp.id} onClick={() => setEditingExpense(exp)} className={`bg-white p-4 rounded-2xl border ${isSettlement ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-100'} flex justify-between items-center hover:shadow-md transition-all cursor-pointer group`}>
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-xl">
                      {isSettlement ? '✅' : (exp.category.includes('Food') ? '🍔' : exp.category.includes('Transport') ? '🚗' : '📦')}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h5 className="font-semibold text-slate-800 group-hover:text-indigo-600 transition-colors">{exp.description}</h5>
                        {isSettlement && <span className="px-2 py-0.5 bg-emerald-500 text-white text-[8px] font-bold rounded-full uppercase">Repayment</span>}
                        {exp.receiptUrl && (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setZoomedReceipt(exp.receiptUrl!);
                            }}
                            className="p-1 text-indigo-500 hover:bg-indigo-50 rounded-md transition-colors"
                            title="View Receipt"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-500">
                        {isSettlement ? `${payer?.name} paid you back` : `Paid by ${payer?.name || 'User'}`}
                      </p>
                      {exp.remarks && <p className="text-[10px] text-slate-400 italic mt-1">"{exp.remarks}"</p>}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-bold ${isSettlement ? 'text-emerald-600' : 'text-slate-900'}`}>{CURRENCY} {exp.amount.toFixed(2)}</p>
                    <p className="text-[10px] text-slate-400 uppercase">{new Date(exp.date).toLocaleDateString()}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'expenses' && (
        <div className="space-y-4 animate-in slide-in-from-right duration-300">
          <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex justify-between items-center">
               <h2 className="text-xl font-bold text-slate-900">Expenses History</h2>
               <button onClick={() => setIsAddingExpense(true)} className="w-10 h-10 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-lg"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg></button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">From Date</label>
                <input type="date" value={exportStartDate} onChange={(e) => setExportStartDate(e.target.value)} className="w-full text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">To Date</label>
                <input type="date" value={exportEndDate} onChange={(e) => setExportEndDate(e.target.value)} className="w-full text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <button 
                onClick={() => exportExpensesToExcel(filteredExpenses, "Export", exportStartDate, exportEndDate)}
                className="w-full py-2 bg-slate-800 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-slate-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Export Excel
              </button>
            </div>

            <div className="relative">
              <input type="text" placeholder="Search expenses..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="block w-full pl-10 pr-3 py-3 border border-slate-200 rounded-2xl bg-slate-50 focus:ring-2 focus:ring-indigo-500 outline-none text-sm" />
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg></div>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar">
              <button onClick={() => setPersonFilter(null)} className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${personFilter === null ? 'bg-slate-800 text-white shadow-md' : 'bg-slate-50 border border-slate-200 text-slate-600'}`}>All</button>
              {people.map(person => (
                <button key={person.id} onClick={() => setPersonFilter(person.id)} className={`flex items-center gap-2 px-3 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${personFilter === person.id ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-50 border border-slate-200 text-slate-600'}`}>
                  <img src={person.avatar} className="w-4 h-4 rounded-full" alt="" /> {person.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {filteredExpenses.map(exp => {
              const displayAmount = personFilter ? (exp.splits.find(s => s.personId === personFilter)?.amount || 0) : exp.amount;
              const isSettlement = exp.category === 'Settlement';
              const payer = people.find(p => p.id === exp.paidBy);
              return (
                <div key={exp.id} onClick={() => setEditingExpense(exp)} className={`bg-white p-4 rounded-2xl border ${isSettlement ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-100'} flex justify-between items-center group cursor-pointer hover:shadow-md transition-all`}>
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-lg">
                      {isSettlement ? '✅' : exp.category.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h5 className="font-semibold text-slate-800 group-hover:text-indigo-600 transition-colors">{exp.description}</h5>
                        {isSettlement && <span className="px-2 py-0.5 bg-emerald-500 text-white text-[8px] font-bold rounded-full uppercase">Repayment</span>}
                        {exp.receiptUrl && (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setZoomedReceipt(exp.receiptUrl!);
                            }}
                            className="p-1 text-indigo-500 hover:bg-indigo-50 rounded-md transition-colors"
                            title="View Receipt"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400">
                        {isSettlement ? `From ${payer?.name}` : exp.category}
                      </p>
                      {exp.remarks && <p className="text-[10px] text-slate-400 italic mt-1">"{exp.remarks}"</p>}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-bold ${isSettlement ? 'text-emerald-600' : 'text-slate-900'}`}>{CURRENCY} {displayAmount.toFixed(2)}</p>
                    <p className="text-[10px] text-slate-400">{new Date(exp.date).toLocaleDateString()}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'people' && (
        <div className="space-y-8 animate-in slide-in-from-left duration-300 pb-10">
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-slate-900">People</h2>
              <button onClick={handleAddPerson} className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 transition-all">+ Add Person</button>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {people.map(person => {
                const balance = balances.find(b => b.personId === person.id);
                const netBalance = getNetBalanceWithMe(person.id);
                return (
                  <div key={person.id}>
                    <div className="bg-white p-5 rounded-3xl border border-slate-100 flex items-center justify-between group">
                      <div className="flex items-center gap-4">
                        <div className="relative group/avatar">
                          <img src={person.avatar} alt={person.name} className="w-14 h-14 rounded-2xl object-cover" />
                          <button 
                            onClick={() => {
                              setEditingPerson(person);
                              fileInputRef.current?.click();
                            }}
                            className="absolute inset-0 bg-black/40 rounded-2xl opacity-0 group-hover/avatar:opacity-100 flex items-center justify-center transition-opacity"
                          >
                            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                          </button>
                        </div>
                        <div>
                          <h4 className="text-lg font-bold text-slate-900">{person.name} {person.id === 'me' ? '(You)' : ''}</h4>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Share: {CURRENCY} {balance?.totalSpent.toFixed(2)}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold ${netBalance > 0 ? 'text-emerald-500' : netBalance < 0 ? 'text-rose-500' : 'text-slate-400'}`}>
                          {person.id === 'me' ? 'Settled' : (netBalance > 0 ? `Owes You ${CURRENCY} ${netBalance.toFixed(2)}` : netBalance < 0 ? `You owe ${CURRENCY} ${Math.abs(netBalance).toFixed(2)}` : 'Settled')}
                        </p>
                        {person.id !== 'me' && netBalance > 0 && (
                          <button onClick={() => handleSettleUp(person.id, netBalance)} className="mt-2 px-3 py-1 bg-emerald-50 text-emerald-600 text-[10px] font-bold rounded-full border border-emerald-100 hover:bg-emerald-100 transition-colors">Record Repayment</button>
                        )}
                      </div>
                    </div>
                    
                    {/* Repayment History for this person */}
                    <div className="mt-2 ml-14 space-y-2">
                      {expenses
                        .filter(exp => exp.category === 'Settlement' && (exp.paidBy === person.id || exp.splits.some(s => s.personId === person.id)))
                        .slice(0, 3)
                        .map(repayment => (
                          <div key={repayment.id} className="flex justify-between items-center text-[10px] bg-emerald-50/50 p-2 rounded-xl border border-emerald-100/50">
                            <div className="flex items-center gap-2">
                              <span className="text-emerald-600 font-bold">Repayment</span>
                              <span className="text-slate-500">{new Date(repayment.date).toLocaleDateString()}</span>
                            </div>
                            <span className="font-bold text-emerald-700">{CURRENCY} {repayment.amount.toFixed(2)}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-8 space-y-8">
            <div>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-slate-800">Manage Categories</h3>
                <button onClick={handleAddCategory} className="text-xs font-bold text-indigo-600 hover:underline">+ New Category</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {categories.map(cat => (
                  <div key={cat} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl group hover:border-indigo-200 transition-colors">
                    <span className="text-sm font-medium text-slate-700">{cat}</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                      <button onClick={() => handleEditCategory(cat)} className="text-slate-300 hover:text-indigo-500 transition-all p-1">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      </button>
                      <button onClick={() => handleDeleteCategory(cat)} className="text-slate-300 hover:text-rose-500 transition-all p-1">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-slate-800">Payment Methods</h3>
                <button onClick={handleAddPaymentMethod} className="text-xs font-bold text-indigo-600 hover:underline">+ New Method</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {paymentMethods.map(method => (
                  <div key={method} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl group hover:border-indigo-200 transition-colors">
                    <span className="text-sm font-medium text-slate-700">{method}</span>
                    <button onClick={() => handleDeletePaymentMethod(method)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-500 transition-all"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'notes' && (
        <Notes />
      )}

      {isAddingExpense && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="w-full max-w-lg animate-in slide-in-from-bottom duration-300">
            <ExpenseForm people={people} categories={categories} paymentMethods={paymentMethods} onAddExpense={handleAddExpense} onCancel={() => setIsAddingExpense(false)} />
          </div>
        </div>
      )}

      {editingExpense && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="w-full max-w-lg animate-in slide-in-from-bottom duration-300">
            <ExpenseForm 
              people={people} 
              categories={categories} 
              paymentMethods={paymentMethods} 
              initialData={editingExpense} 
              onAddExpense={() => {}} 
              onUpdateExpense={handleUpdateExpense} 
              onDeleteExpense={handleDeleteExpense} 
              onCancel={() => setEditingExpense(null)} 
            />
          </div>
        </div>
      )}

      {zoomedReceipt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/90 backdrop-blur-md animate-in fade-in duration-300">
          <div className="relative max-w-4xl w-full max-h-[90vh] flex flex-col items-center">
            <div className="absolute -top-12 right-0 flex gap-4">
              <button 
                onClick={() => downloadReceipt(zoomedReceipt, 'receipt')}
                className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-full transition-colors flex items-center gap-2 px-4"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span className="text-sm font-bold">Download</span>
              </button>
              <button 
                onClick={() => setZoomedReceipt(null)}
                className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-full transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <img 
              src={zoomedReceipt} 
              alt="Receipt Zoomed" 
              className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl border border-white/10" 
            />
          </div>
        </div>
      )}
    </Layout>
  );
};

export default App;
