import React, { useState, useEffect } from 'react';
import { getExpenses, saveExpense } from '../helpers/storage';
import { Plus } from 'lucide-react';

export default function Expenses() {
  const [expenses, setExpenses] = useState([]);
  const [showModal, setShowModal] = useState(false);

  // Form
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('RENT');
  const [description, setDescription] = useState('');

  useEffect(() => {
    setExpenses(getExpenses());
  }, [showModal]);

  const handleSave = () => {
    const expense = {
      expense_date: new Date().toISOString().split('T')[0],
      category,
      description,
      amount: parseFloat(amount),
      branch_office: 'ROME_HQ',
      payment_mode: 'BANK_TRANSFER'
    };
    saveExpense(expense);
    setShowModal(false);
  };

  return (
    <div className="page-container fade-in">
      <header className="page-header" style={{display:'flex', justifyContent:'space-between'}}>
        <div>
          <h1>Expenses</h1>
          <p>Track business expenditures.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Add Expense
        </button>
      </header>

      <div className="card">
        <table className="data-table" style={{width: '100%', textAlign: 'left', borderCollapse: 'collapse'}}>
          <thead>
            <tr style={{borderBottom: '1px solid var(--border)'}}>
              <th style={{padding: '12px 8px'}}>Date</th>
              <th style={{padding: '12px 8px'}}>Category</th>
              <th style={{padding: '12px 8px'}}>Description</th>
              <th style={{padding: '12px 8px'}}>Amount (€)</th>
              <th style={{padding: '12px 8px'}}>Branch</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map(e => (
              <tr key={e.id} style={{borderBottom: '1px solid var(--border)'}}>
                <td style={{padding: '12px 8px'}}>{e.expense_date}</td>
                <td style={{padding: '12px 8px', fontWeight: 'bold'}}>{e.category}</td>
                <td style={{padding: '12px 8px'}}>{e.description}</td>
                <td style={{padding: '12px 8px'}}>€{e.amount}</td>
                <td style={{padding: '12px 8px'}}>{e.branch_office}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div className="card" style={{width: '400px'}}>
            <h3>Add Expense</h3>
            <div style={{display:'flex', flexDirection:'column', gap:'15px', marginTop:'20px'}}>
              <div>
                <label style={{display:'block', marginBottom:'5px'}}>Category</label>
                <select value={category} onChange={e => setCategory(e.target.value)} style={{width:'100%', padding:'8px'}}>
                  <option value="RENT">Rent</option>
                  <option value="SALARIES">Salaries</option>
                  <option value="MARKETING">Marketing</option>
                  <option value="UTILITIES">Utilities</option>
                  <option value="MISC">Miscellaneous</option>
                </select>
              </div>
              <div>
                <label style={{display:'block', marginBottom:'5px'}}>Description</label>
                <input type="text" value={description} onChange={e => setDescription(e.target.value)} style={{width:'100%', padding:'8px'}} />
              </div>
              <div>
                <label style={{display:'block', marginBottom:'5px'}}>Amount (€)</label>
                <input type="number" value={amount} onChange={e => setAmount(e.target.value)} style={{width:'100%', padding:'8px'}} />
              </div>
              <div style={{display:'flex', gap:'10px', marginTop:'10px'}}>
                <button className="btn btn-primary" onClick={handleSave}>Save</button>
                <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
