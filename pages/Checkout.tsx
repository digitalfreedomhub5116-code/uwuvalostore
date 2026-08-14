
import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import { Account, RAZORPAY_KEY_ID, BookingStatus, Booking } from '../types';
import { StorageService } from '../services/storage';
import { Copy, ArrowRight, Timer, CalendarClock, Smartphone, ShieldCheck, Zap, Send, Ticket, CheckCircle, XCircle, Loader2, AlertCircle, MessageCircle, CreditCard } from 'lucide-react';

interface CheckoutState {
  orderId?: string; // Optional because legacy flow might not have it, but new flow will
  account: Account;
  hours: number;
  price: number;
  originalPrice?: number;
  durationLabel: '1 Hour' | '3 Hours' | '12 Hours' | '24 Hours';
  startMode: 'now' | 'later';
  scheduledTime?: string;
}

const Checkout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as CheckoutState;
  
  const [orderId, setOrderId] = useState(state?.orderId || '');
  const [timer, setTimer] = useState(600); // 10 minutes for payment
  const [isRazorpayLoading, setIsRazorpayLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Coupon State
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; type: 'PERCENT' | 'FLAT'; value: number } | null>(null);
  const [couponMessage, setCouponMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isValidatingCoupon, setIsValidatingCoupon] = useState(false);

  const currentUser = StorageService.getCurrentUser();

  useEffect(() => {
    if (state && !state.orderId) {
      // Fallback generation if no pre-locked ID (Legacy support)
      const id = 'KV-' + Math.floor(1000 + Math.random() * 9000);
      setOrderId(id);
    }
  }, [state]);

  // Payment Timer countdown
  useEffect(() => {
    if (timer > 0) {
      const interval = setInterval(() => setTimer(t => t - 1), 1000);
      return () => clearInterval(interval);
    } else {
       // Timer expired - navigate away or show error
       setError("Session expired.");
    }
  }, [timer]);

  if (!state) {
    return <Navigate to="/browse" />;
  }

  // Calculate rental period for display
  const startDateTime = state.startMode === 'later' && state.scheduledTime 
    ? new Date(state.scheduledTime) 
    : new Date();
    
  const endDateTime = new Date(startDateTime.getTime() + state.hours * 60 * 60 * 1000);

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // --- Price Calculations ---
  const basePrice = state.price;
  let finalPrice = basePrice;
  let discountAmount = 0;

  if (appliedCoupon) {
    if (appliedCoupon.type === 'PERCENT') {
      discountAmount = Math.floor((basePrice * appliedCoupon.value) / 100);
    } else {
      discountAmount = appliedCoupon.value;
    }
    // Prevent negative price
    if (discountAmount > basePrice) discountAmount = basePrice;
    finalPrice = basePrice - discountAmount;
  }


  // --- Coupon Handlers ---
  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return;
    setIsValidatingCoupon(true);
    setCouponMessage(null);
    setAppliedCoupon(null);

    try {
      const result = await StorageService.validateCoupon(couponCode);
      if (result.valid && result.type && result.value) {
         setAppliedCoupon({ code: couponCode.toUpperCase(), type: result.type, value: result.value });
         setCouponMessage({ type: 'success', text: result.message });
      } else {
         setCouponMessage({ type: 'error', text: result.message });
      }
    } catch (err) {
      setCouponMessage({ type: 'error', text: "Verification failed. Try again." });
    } finally {
      setIsValidatingCoupon(false);
    }
  };

  const removeCoupon = () => {
    setAppliedCoupon(null);
    setCouponCode('');
    setCouponMessage(null);
  };

  const handleStartChat = () => {
    if (!currentUser) return;
    navigate('/dashboard', {
        state: {
            tab: 'messages',
            chatWith: state.account.listedBy,
            accountId: state.account.id
        }
    });
  };

  const handleRazorpayPayment = async () => {
    setError('');
    
    if (typeof (window as any).Razorpay === 'undefined') {
      setError('Razorpay SDK is loading or unavailable. Please refresh.');
      return;
    }

    setIsRazorpayLoading(true);

    try {
      const options = {
        key: RAZORPAY_KEY_ID,
        amount: Math.round(finalPrice * 100),
        currency: 'INR',
        name: 'UwU Valo Store',
        description: `Rental: ${state.account.name} (${state.durationLabel})`,
        image: '/logo.png',
        handler: async function (response: any) {
          try {
            const paymentId = response.razorpay_payment_id;

            if (appliedCoupon) {
              await StorageService.incrementCouponUsage(appliedCoupon.code);
            }

            const isFuture = state.startMode === 'later' && state.scheduledTime && new Date(state.scheduledTime).getTime() > Date.now();
            const bookingStatus = isFuture ? BookingStatus.PRE_BOOKED : BookingStatus.ACTIVE;

            const booking: Booking = {
              orderId,
              accountId: state.account.id,
              accountName: state.account.name,
              durationLabel: state.durationLabel,
              hours: state.hours,
              totalPrice: finalPrice,
              startTime: startDateTime.toISOString(),
              endTime: endDateTime.toISOString(),
              status: bookingStatus,
              createdAt: new Date().toISOString(),
              utr: `RZP-${paymentId}`,
              razorpayPaymentId: paymentId,
              customerId: currentUser?.id,
              customerName: currentUser?.name,
              couponCode: appliedCoupon ? appliedCoupon.code : undefined,
              discountApplied: appliedCoupon ? discountAmount : undefined
            };

            if (state.orderId) {
              await StorageService.updateBooking(booking);
            } else {
              await StorageService.createBooking(booking);
            }

            // Lock account automatically in Supabase if active
            if (bookingStatus === BookingStatus.ACTIVE) {
              const account = await StorageService.getAccountById(state.account.id);
              if (account) {
                account.isBooked = true;
                account.bookedUntil = endDateTime.toISOString();
                await StorageService.saveAccount(account);
              }
            }

            // Direct redirect to User Dashboard with credentials instantly revealed
            navigate('/dashboard');
          } catch (err: any) {
            setError(err.message || 'Booking save failed after payment.');
          } finally {
            setIsRazorpayLoading(false);
          }
        },
        prefill: {
          name: currentUser?.name || '',
          email: currentUser?.email || '',
          contact: currentUser?.phone || ''
        },
        theme: {
          color: '#e84393'
        },
        modal: {
          ondismiss: function () {
            setIsRazorpayLoading(false);
          }
        }
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.on('payment.failed', function (response: any) {
        setIsRazorpayLoading(false);
        setError(response.error?.description || 'Payment failed. Please try again.');
      });
      rzp.open();
    } catch (err: any) {
      setIsRazorpayLoading(false);
      setError(err.message || 'Failed to initialize Razorpay checkout.');
    }
  };



  const isUserListed = !!state.account.listedBy && state.account.listedBy !== currentUser?.id;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-slate-400 text-sm">
        <span onClick={() => navigate('/browse')} className="cursor-pointer hover:text-white">Browse</span>
        <ArrowRight className="w-3 h-3" />
        <span className="text-white">Checkout</span>
      </div>

      <div className="space-y-6">

         {/* SECTION 1: TIMER */}
         <div className="bg-brand-surface border border-brand-accent/30 rounded-xl p-4 flex items-center justify-between shadow-[0_0_15px_rgba(232,67,147,0.1)]">
             <div className="flex items-center gap-2 text-brand-accent">
               <Timer className="w-5 h-5" />
               <span className="font-bold">Session Time</span>
             </div>
             <div className="font-mono text-xl font-bold">{formatTimer(timer)}</div>
         </div>

         {/* SECTION 2: ORDER SUMMARY (Top) */}
         <div className="bg-brand-surface border border-white/10 rounded-xl p-6 relative overflow-hidden">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
               <span className="w-8 h-8 rounded-full bg-brand-surface border border-white/20 flex items-center justify-center text-sm text-slate-400">1</span>
               Order Summary
            </h2>
            
            <div className="flex flex-col md:flex-row gap-6 pb-6 border-b border-white/10">
               <div className="flex items-start gap-4 flex-1">
                  <img src={state.account.imageUrl} className="w-24 h-24 rounded-lg object-cover border border-white/10" alt="" />
                  <div>
                    <h3 className="font-bold text-xl text-white">{state.account.name}</h3>
                    <div className="mt-1 inline-block text-xs font-bold text-brand-secondary bg-brand-secondary/10 px-2 py-0.5 rounded border border-brand-secondary/20 uppercase tracking-wider">
                      {state.account.rank}
                    </div>
                    <div className="text-sm text-slate-400 mt-2 font-mono">Order: {orderId}</div>
                    
                    {/* Chat with Owner Button */}
                    {isUserListed && currentUser && (
                        <button 
                            onClick={handleStartChat}
                            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-dark hover:bg-brand-cyan/10 text-slate-300 hover:text-brand-cyan border border-white/10 hover:border-brand-cyan/50 rounded-lg text-xs font-bold uppercase tracking-wider transition-all"
                        >
                            <MessageCircle size={14} />
                            Chat with Owner
                        </button>
                    )}
                  </div>
               </div>
               
               {/* Totals Display */}
               <div className="flex-1 space-y-2 md:text-right">
                  <div className="flex justify-between md:justify-end gap-8 text-slate-300">
                    <span>Duration</span>
                    <span className="text-white font-bold">{state.durationLabel}</span>
                  </div>
                  <div className="flex justify-between md:justify-end gap-8 text-slate-300">
                    <span>Subtotal</span>
                    <span className={state.originalPrice ? 'line-through text-slate-500' : 'text-white'}>
                       ₹{state.originalPrice || state.price}
                    </span>
                  </div>
                  {state.originalPrice && (
                     <div className="flex justify-between md:justify-end gap-8 text-brand-accent font-bold text-sm">
                        <span>24h Discount</span>
                        <span>-₹{(state.originalPrice - state.price).toFixed(0)}</span>
                     </div>
                  )}
                  {appliedCoupon && (
                     <div className="flex justify-between md:justify-end gap-8 text-green-400 font-bold text-sm">
                        <span>Coupon ({appliedCoupon.code})</span>
                        <span>-₹{discountAmount}</span>
                     </div>
                  )}
                  <div className="flex justify-between md:justify-end gap-8 items-center pt-2 border-t border-white/10 mt-2">
                    <span className="font-bold text-lg">Total Pay</span>
                    <span className="font-bold text-2xl text-brand-accent">₹{finalPrice}</span>
                  </div>
               </div>
            </div>

            {/* Schedule & Coupon Block */}
            <div className="grid md:grid-cols-2 gap-6 mt-6">
                {/* Schedule */}
                <div className="bg-white/5 rounded-lg p-4 border border-white/5">
                    <div className="flex items-center gap-2 mb-3 text-brand-accent font-bold text-sm uppercase tracking-wide">
                        <CalendarClock className="w-4 h-4" /> Schedule
                    </div>
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-slate-400">Start Time</span>
                            <span className="text-white font-mono">
                                {state.startMode === 'now' 
                                ? 'Immediate' 
                                : startDateTime.toLocaleString('en-IN', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-400">End Time</span>
                            <span className="text-white font-mono">
                                {endDateTime.toLocaleString('en-IN', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Coupon */}
                <div>
                     <div className="relative h-full">
                        {appliedCoupon ? (
                          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex justify-between items-center h-full">
                             <div className="flex items-center gap-2">
                                <Ticket className="w-5 h-5 text-green-400" />
                                <div>
                                   <div className="text-sm text-green-400 font-bold uppercase tracking-wider">{appliedCoupon.code}</div>
                                   <div className="text-[10px] text-green-300">Discount Applied</div>
                                </div>
                             </div>
                             <button onClick={removeCoupon} className="text-slate-500 hover:text-white p-2"><XCircle className="w-5 h-5" /></button>
                          </div>
                        ) : (
                          <div className="flex gap-2 h-full items-start">
                             <div className="relative flex-1">
                                <Ticket className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
                                <input 
                                  type="text" 
                                  placeholder="COUPON CODE"
                                  value={couponCode}
                                  onChange={(e) => {
                                     setCouponCode(e.target.value.toUpperCase());
                                     setCouponMessage(null);
                                  }}
                                  onKeyPress={(e) => e.key === 'Enter' && handleApplyCoupon()}
                                  className="w-full bg-brand-dark border border-white/10 rounded-lg py-3 pl-10 pr-3 text-sm text-white focus:border-brand-accent outline-none font-mono uppercase"
                                />
                             </div>
                             <button 
                               onClick={handleApplyCoupon}
                               disabled={isValidatingCoupon || !couponCode}
                               className="px-5 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-bold uppercase tracking-wide transition-colors disabled:opacity-50 h-[46px]"
                             >
                               {isValidatingCoupon ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}
                             </button>
                          </div>
                        )}
                        {couponMessage && (
                           <div className={`text-[10px] mt-2 flex items-center gap-1.5 ${couponMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                              {couponMessage.type === 'success' ? <CheckCircle size={12} /> : <XCircle size={12} />}
                              {couponMessage.text}
                           </div>
                        )}
                     </div>
                </div>
            </div>
         </div>

         {/* SECTION 3: PAYMENT & VERIFICATION */}
         <div className="bg-brand-surface border border-white/10 rounded-xl p-6 relative overflow-hidden">
             {/* Background Glow */}
             <div className="absolute top-0 right-0 w-64 h-64 bg-brand-accent/5 blur-3xl rounded-full pointer-events-none"></div>

             <div className="flex items-center gap-3 mb-6 border-b border-white/5 pb-4">
                <div className="w-10 h-10 rounded-full bg-brand-accent/20 flex items-center justify-center border border-brand-accent/50 shrink-0 shadow-[0_0_15px_rgba(232,67,147,0.3)]">
                  <CreditCard className="text-brand-accent w-5 h-5" />
                </div>
                <h2 className="text-xl md:text-2xl font-black text-white italic uppercase tracking-wider">
                  Payment Gateway
                </h2>
              </div>

               {/* RAZORPAY PAYMENT GATEWAY */}
               <div className="bg-brand-dark/60 border border-white/10 rounded-2xl p-6 sm:p-8 text-center space-y-6">
                 <div className="max-w-md mx-auto space-y-4">
                   <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-accent/10 border border-brand-accent/30 text-brand-accent mb-2">
                     <CreditCard size={32} />
                   </div>

                   <h3 className="text-2xl font-bold text-white tracking-wide">
                     Pay ₹{finalPrice} with Razorpay
                   </h3>
                   <p className="text-slate-400 text-sm leading-relaxed">
                     Supports UPI (GPay, PhonePe, Paytm), Debit & Credit Cards, Net Banking, and Wallets.
                   </p>

                   {/* Payment Options Badges */}
                   <div className="flex flex-wrap justify-center gap-2 pt-2">
                     {['GPay', 'PhonePe', 'Paytm', 'UPI ID', 'Cards', 'Net Banking'].map((method, idx) => (
                       <span key={idx} className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 bg-white/5 border border-white/10 rounded-md text-slate-300">
                         {method}
                       </span>
                     ))}
                   </div>
                 </div>

                 {error && (
                   <div className="max-w-md mx-auto p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs font-bold flex items-center justify-center gap-2">
                     <AlertCircle size={14} /> {error}
                   </div>
                 )}

                 <div className="max-w-md mx-auto pt-2">
                   <button
                     onClick={handleRazorpayPayment}
                     disabled={isRazorpayLoading}
                     className="w-full bg-brand-accent hover:bg-pink-600 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 transition-all duration-300 shadow-[0_0_25px_rgba(232,67,147,0.3)] hover:shadow-[0_0_35px_rgba(232,67,147,0.5)] hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none text-base"
                   >
                     {isRazorpayLoading ? (
                       <>
                         <Loader2 className="w-5 h-5 animate-spin" />
                         <span>Opening Gateway...</span>
                       </>
                     ) : (
                       <>
                         <Zap className="w-5 h-5 fill-white" />
                         <span>PAY ₹{finalPrice} NOW</span>
                         <ArrowRight className="w-5 h-5" />
                       </>
                     )}
                   </button>
                   
                   <p className="text-[10px] text-slate-500 mt-3 flex items-center justify-center gap-1">
                     <ShieldCheck size={12} className="text-green-400" />
                     256-Bit SSL Encrypted & Secure Razorpay Payment
                   </p>
                 </div>
               </div>
         </div>
      </div>
    </div>
  );
};

export default Checkout;
