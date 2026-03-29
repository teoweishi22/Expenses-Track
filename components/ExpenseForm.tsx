
import React, { useState, useEffect } from 'react';
import { Person, Expense } from '../types';
import { compressImage } from '../src/utils/image';

interface ExpenseFormProps {
  people: Person[];
  categories: string[];
  paymentMethods: string[];
  onAddExpense: (expense: Omit<Expense, 'id'>) => void;
  onUpdateExpense?: (id: string, expense: Omit<Expense, 'id'>) => void;
  onDeleteExpense?: (id: string) => void;
  onCancel: () => void;
  initialData?: Expense;
}

const ExpenseForm: React.FC<ExpenseFormProps> = ({ 
  people, 
  categories,
  paymentMethods,
  onAddExpense, 
  onUpdateExpense,
  onDeleteExpense,
  onCancel, 
  initialData 
}) => {
  const [description, setDescription] = useState(initialData?.description || '');
  const [amount, setAmount] = useState(initialData?.amount?.toString() || '');
  const [date, setDate] = useState(initialData?.date ? new Date(initialData.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
  const [category, setCategory] = useState(initialData?.category || categories[0] || 'Other');
  const [paymentMethod, setPaymentMethod] = useState(initialData?.paymentMethod || paymentMethods[0] || 'Cash');
  const [paidBy, setPaidBy] = useState(initialData?.paidBy || people[0]?.id || '');
  const [remarks, setRemarks] = useState(initialData?.remarks || '');
  const [receiptUrl, setReceiptUrl] = useState(initialData?.receiptUrl || '');
  
  // Detect if initial data was a personal expense (only one person in split and it's the payer)
  const isInitiallyPersonal = initialData 
    ? initialData.splits.length === 1 && initialData.splits[0].personId === initialData.paidBy
    : true; 

  const [isPersonal, setIsPersonal] = useState(isInitiallyPersonal);
  const [selectedSplitIds, setSelectedSplitIds] = useState<string[]>(
    initialData?.splits.map(s => s.personId) || [people[0]?.id || 'me']
  );
  const [error, setError] = useState<string | null>(null);

  // Synchronize split with payer if it's a personal expense
  useEffect(() => {
    if (isPersonal) {
      setSelectedSplitIds([paidBy]);
    }
  }, [paidBy, isPersonal]);

  // Calculate the individual share for "direct count" feedback
  const totalAmountValue = parseFloat(amount) || 0;
  const activeSplitsCount = isPersonal ? 1 : selectedSplitIds.length;
  const individualShare = activeSplitsCount > 0 ? totalAmountValue / activeSplitsCount : 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!description || totalAmountValue <= 0) {
      setError("Please fill in description and a valid amount.");
      return;
    }

    const currentSplits = isPersonal ? [paidBy] : selectedSplitIds;

    if (currentSplits.length === 0) {
      setError("Please select at least one person to split the expense with.");
      return;
    }

    const splits = currentSplits.map(id => ({
      personId: id,
      amount: individualShare
    }));

    const expenseData = {
      description,
      amount: totalAmountValue,
      date: new Date(date).toISOString(),
      category,
      paymentMethod,
      paidBy,
      splits,
      remarks,
      receiptUrl
    };

    if (initialData && onUpdateExpense) {
      onUpdateExpense(initialData.id, expenseData);
    } else {
      onAddExpense(expenseData);
    }
  };

  const handleReceiptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const compressed = await compressImage(reader.result as string);
        setReceiptUrl(compressed);
      };
      reader.readAsDataURL(file);
    }
  };

  const toggleSplitPerson = (id: string) => {
    if (isPersonal) return;
    setSelectedSplitIds(prev => 
      prev.includes(id) ? prev.filter(pId => pId !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedSplitIds.length === people.length) {
      setSelectedSplitIds([]);
    } else {
      setSelectedSplitIds(people.map(p => p.id));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white p-6 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 overflow-y-auto max-h-[95vh]">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-slate-800">
          {initialData ? 'Edit Expense' : 'New Expense'}
        </h2>
        <div className="flex items-center gap-4">
          {initialData && onDeleteExpense && (
            <button 
              type="button" 
              onClick={() => onDeleteExpense(initialData.id)}
              className="text-rose-500 hover:text-rose-700 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-600 p-2">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expense Type Toggle */}
      <div className="flex p-1 bg-slate-100 rounded-2xl">
        <button
          type="button"
          onClick={() => setIsPersonal(true)}
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${isPersonal ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Personal Expense
        </button>
        <button
          type="button"
          onClick={() => setIsPersonal(false)}
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${!isPersonal ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Split Bill
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Description</label>
          <input
            type="text"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What was this for?"
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Amount (RM)</label>
            <input
              type="number"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Date</label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none bg-white transition-all"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none bg-white transition-all"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Payment Method</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none bg-white transition-all"
            >
              {paymentMethods.map(method => (
                <option key={method} value={method}>{method}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Remarks</label>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Add any extra details..."
            rows={2}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all resize-none"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Receipt Image</label>
          <div className="flex items-center gap-4">
            {receiptUrl ? (
              <div className="relative group">
                <img src={receiptUrl} alt="Receipt" className="w-20 h-20 object-cover rounded-xl border border-slate-200" />
                <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    type="button" 
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = receiptUrl;
                      link.download = `receipt_${description.replace(/\s+/g, '_') || 'image'}.png`;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    }}
                    className="bg-indigo-500 text-white rounded-full p-1 shadow-lg"
                    title="Download Receipt"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setReceiptUrl('')}
                    className="bg-rose-500 text-white rounded-full p-1 shadow-lg"
                    title="Remove Receipt"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-20 h-20 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-all">
                <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-[10px] text-slate-400 mt-1 font-bold">Upload</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleReceiptUpload} />
              </label>
            )}
            <div className="flex-1">
              <p className="text-[10px] text-slate-400 leading-tight">
                Upload a photo of your receipt for record keeping.
              </p>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
            {isPersonal ? 'Who paid?' : 'Paid By'}
          </label>
          <div className="flex gap-2 overflow-x-auto py-2 no-scrollbar">
            {people.map(person => (
              <button
                key={person.id}
                type="button"
                onClick={() => setPaidBy(person.id)}
                className={`flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-full border transition-all ${
                  paidBy === person.id 
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' 
                    : 'bg-white border-slate-200 text-slate-600'
                }`}
              >
                <img src={person.avatar} alt="" className="w-5 h-5 rounded-full object-cover" />
                <span className="text-xs font-bold">{person.name}</span>
              </button>
            ))}
          </div>
        </div>

        {!isPersonal && (
          <div className="animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex justify-between items-end mb-2">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Split Between</label>
                {totalAmountValue > 0 && selectedSplitIds.length > 0 ? (
                  <p className="text-indigo-600 font-bold text-sm">
                    Each pays: <span className="bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-100">RM {individualShare.toFixed(2)}</span>
                  </p>
                ) : (
                  <p className="text-slate-400 text-[10px] italic">Select people to see the share</p>
                )}
              </div>
              <button 
                type="button" 
                onClick={handleSelectAll}
                className="text-[10px] font-bold text-indigo-600 hover:underline px-2 py-1 rounded-md hover:bg-indigo-50 transition-colors"
              >
                {selectedSplitIds.length === people.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-3 mt-2">
              {people.map(person => {
                const isSelected = selectedSplitIds.includes(person.id);
                return (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => toggleSplitPerson(person.id)}
                    className={`relative flex items-center gap-3 p-3 rounded-2xl border transition-all ${
                      isSelected
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700 ring-2 ring-indigo-600/5'
                        : 'bg-white border-slate-100 text-slate-400'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                      isSelected ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300'
                    }`}>
                      {isSelected && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <img src={person.avatar} className="w-6 h-6 rounded-lg object-cover" alt="" />
                        <span className="text-xs font-bold truncate">{person.name}</span>
                      </div>
                      {isSelected && totalAmountValue > 0 && (
                        <p className="text-[10px] font-black text-indigo-500 mt-0.5">RM {individualShare.toFixed(2)}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-rose-50 text-rose-600 p-3 rounded-xl text-sm font-medium border border-rose-100 mt-4">
          {error}
        </div>
      )}

      <button
        type="submit"
        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl shadow-xl shadow-indigo-100 transition-all flex items-center justify-center gap-2 mt-4"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
        {initialData ? 'Update Expense' : 'Save Expense'}
      </button>
    </form>
  );
};

export default ExpenseForm;
