import React, { useState, useEffect } from 'react';
import { getBookings, saveBooking } from '../helpers/storage';
import { getPaymentStatus } from '../helpers/calculations';
import { extractTextFromPDF, parseTicketData } from '../helpers/pdfParser';
import { Plane, UploadCloud, Search, Plus, FileText, CheckCircle2 } from 'lucide-react';

export default function Bookings() {
  const [activeTab, setActiveTab] = useState('LIST'); // LIST, ADD, UPLOAD
  const [bookings, setBookings] = useState([]);
  const [search, setSearch] = useState('');
  
  // PDF Upload State
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfStatus, setPdfStatus] = useState(''); // '', 'processing', 'success', 'error'
  const [extractedData, setExtractedData] = useState(null);

  useEffect(() => {
    setBookings(getBookings());
  }, [activeTab]);

  const filteredBookings = bookings.filter(b => 
    b.pnr.toLowerCase().includes(search.toLowerCase()) || 
    (b.passenger_name && b.passenger_name.toLowerCase().includes(search.toLowerCase())) ||
    b.ticket_no.includes(search)
  );

  const handlePdfUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setPdfFile(file);
    setPdfStatus('processing');
    
    try {
      const text = await extractTextFromPDF(file);
      const data = parseTicketData(text);
      setExtractedData(data);
      setPdfStatus('success');
    } catch (err) {
      console.error(err);
      setPdfStatus('error');
    }
  };

  const saveExtractedBooking = () => {
    if (!extractedData) return;
    const newBooking = {
      pnr: extractedData.pnr.value,
      passenger_name: extractedData.passenger_name.value,
      ticket_no: extractedData.ticket_no.value,
      airline: extractedData.airline.value,
      fare_sold: extractedData.fare_sold.value || 0,
      fare_issued: (extractedData.fare_sold.value || 0) * 0.9, // rough estimate
      total_paid: 0,
      balance_due: extractedData.fare_sold.value || 0,
      payment_status: 'UNPAID',
      created_at: new Date().toISOString()
    };
    saveBooking(newBooking);
    setPdfStatus('');
    setPdfFile(null);
    setExtractedData(null);
    setActiveTab('LIST');
  };

  return (
    <div className="page-container fade-in">
      <header className="page-header" style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <div>
          <h1>Bookings</h1>
          <p>Manage passenger bookings and tickets.</p>
        </div>
        <div style={{display:'flex', gap:'10px'}}>
          <button className={`btn ${activeTab === 'ADD' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('ADD')}>
            <Plus size={16} /> New Booking
          </button>
          <button className={`btn ${activeTab === 'UPLOAD' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('UPLOAD')}>
            <UploadCloud size={16} /> Upload PDF
          </button>
          <button className={`btn ${activeTab === 'LIST' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('LIST')}>
            List
          </button>
        </div>
      </header>

      {activeTab === 'LIST' && (
        <div className="card">
          <div style={{marginBottom: '20px', display:'flex', gap:'10px', alignItems:'center'}}>
            <Search size={20} color="var(--zinc-400)" />
            <input 
              type="text" 
              placeholder="Search PNR, Name, Ticket..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{padding: '8px', width: '300px', borderRadius: '4px', border: '1px solid var(--border)'}}
            />
          </div>
          
          <table className="data-table" style={{width: '100%', textAlign: 'left', borderCollapse: 'collapse'}}>
            <thead>
              <tr style={{borderBottom: '1px solid var(--border)'}}>
                <th style={{padding: '12px 8px'}}>PNR</th>
                <th style={{padding: '12px 8px'}}>Passenger</th>
                <th style={{padding: '12px 8px'}}>Airline</th>
                <th style={{padding: '12px 8px'}}>Fare (€)</th>
                <th style={{padding: '12px 8px'}}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredBookings.map(b => (
                <tr key={b.id} style={{borderBottom: '1px solid var(--border)'}}>
                  <td style={{padding: '12px 8px', fontWeight: 'bold'}}>{b.pnr}</td>
                  <td style={{padding: '12px 8px'}}>{b.passenger_name}</td>
                  <td style={{padding: '12px 8px'}}>{b.airline}</td>
                  <td style={{padding: '12px 8px'}}>{b.fare_sold}</td>
                  <td style={{padding: '12px 8px'}}>
                    <span className={`badge ${b.payment_status.toLowerCase()}`}>
                      {b.payment_status}
                    </span>
                  </td>
                </tr>
              ))}
              {filteredBookings.length === 0 && (
                <tr>
                  <td colSpan="5" style={{padding: '20px', textAlign: 'center', color: 'var(--zinc-500)'}}>
                    No bookings found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'UPLOAD' && (
        <div className="grid-2">
          <div className="card">
            <h3>Upload Ticket PDF</h3>
            <p style={{color: 'var(--zinc-500)', marginBottom: '20px'}}>
              Upload a ticket PDF from ITA Airways, Air India, Emirates, etc. The system will automatically extract PNR and passenger details using OCR/text extraction.
            </p>
            
            <div style={{
              border: '2px dashed var(--border)', 
              padding: '40px', 
              textAlign: 'center', 
              borderRadius: '8px',
              backgroundColor: 'var(--bg-secondary)',
              cursor: 'pointer'
            }} onClick={() => document.getElementById('pdfInput').click()}>
              <UploadCloud size={48} color="var(--zinc-400)" style={{marginBottom: '10px'}} />
              <h4>Click or Drag & Drop PDF</h4>
              <p style={{color: 'var(--zinc-500)'}}>Only .pdf files are supported</p>
              <input 
                id="pdfInput" 
                type="file" 
                accept="application/pdf" 
                style={{display: 'none'}} 
                onChange={handlePdfUpload}
              />
            </div>
            
            {pdfStatus === 'processing' && <p style={{marginTop:'20px', color: 'var(--coral)'}}>Extracting text... please wait.</p>}
            {pdfStatus === 'error' && <p style={{marginTop:'20px', color: '#FF3B30'}}>Failed to extract data. Is it a valid PDF?</p>}
          </div>

          {pdfStatus === 'success' && extractedData && (
            <div className="card">
              <h3>Extracted Data Review</h3>
              <p style={{color: 'var(--zinc-500)', marginBottom: '20px'}}>Please review and correct the extracted details before saving.</p>
              
              <div style={{display:'flex', flexDirection:'column', gap:'15px'}}>
                {Object.entries(extractedData).map(([key, data]) => (
                  <div key={key}>
                    <label style={{display:'block', textTransform:'capitalize', marginBottom:'5px'}}>{key.replace('_', ' ')}</label>
                    <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
                      <input 
                        type="text" 
                        value={data.value} 
                        onChange={(e) => setExtractedData({...extractedData, [key]: {...data, value: e.target.value}})}
                        style={{padding: '8px', flex: 1, borderRadius: '4px', border: '1px solid var(--border)'}}
                      />
                      <span title={`${data.confidence} confidence`} style={{
                        width: '12px', height: '12px', borderRadius: '50%',
                        backgroundColor: data.confidence === 'high' ? '#34C759' : data.confidence === 'medium' ? '#FFCC00' : '#FF3B30'
                      }}></span>
                    </div>
                  </div>
                ))}
              </div>
              
              <button className="btn btn-primary" style={{marginTop: '20px', width: '100%'}} onClick={saveExtractedBooking}>
                Save as Booking
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'ADD' && (
        <div className="card">
          <h3>Add Manual Booking</h3>
          <p style={{color: 'var(--zinc-500)'}}>Form placeholder. For full implementation, this will contain the 28 PRD fields.</p>
          <button className="btn btn-primary" style={{marginTop:'20px'}} onClick={() => setActiveTab('LIST')}>Cancel</button>
        </div>
      )}
    </div>
  );
}
