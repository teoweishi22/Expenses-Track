
import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { Expense } from '../types';
import { CATEGORY_COLORS } from '../constants';

interface ChartsProps {
  expenses: Expense[];
}

const Charts: React.FC<ChartsProps> = ({ expenses }) => {
  const categoryData = expenses.reduce((acc: any[], curr) => {
    const existing = acc.find(item => item.name === curr.category);
    if (existing) {
      existing.value += curr.amount;
    } else {
      acc.push({ name: curr.category, value: curr.amount });
    }
    return acc;
  }, []);

  const recentSpending = expenses
    .slice(-7)
    .map(e => ({
      name: e.description.substring(0, 8) + '...',
      amount: e.amount
    }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 h-80">
        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">By Category</h3>
        <ResponsiveContainer width="100%" height="90%">
          <PieChart>
            <Pie
              data={categoryData}
              innerRadius={60}
              outerRadius={80}
              paddingAngle={5}
              dataKey="value"
            >
              {categoryData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={CATEGORY_COLORS[entry.name] || '#CBD5E1'} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 h-80">
        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Recent Spending</h3>
        <ResponsiveContainer width="100%" height="90%">
          <BarChart data={recentSpending}>
            <XAxis dataKey="name" fontSize={10} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip cursor={{fill: '#f1f5f9'}} />
            <Bar dataKey="amount" fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default Charts;
