
export interface Person {
  id: string;
  name: string;
  avatar: string;
}

export interface Split {
  personId: string;
  amount: number;
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  date: string;
  category: string;
  paymentMethod: string; // New field for Cash, eWallet, etc.
  paidBy: string; // ID of the person who paid
  splits: Split[];
  receiptUrl?: string;
  remarks?: string;
}

export enum ExpenseCategory {
  FOOD = 'Food & Drink',
  TRANSPORT = 'Transport',
  HOUSING = 'Housing',
  ENTERTAINMENT = 'Entertainment',
  SHOPPING = 'Shopping',
  UTILITIES = 'Utilities',
  OTHER = 'Other'
}

export interface Balance {
  personId: string;
  totalSpent: number;
  totalOwed: number;
}
