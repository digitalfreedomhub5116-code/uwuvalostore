
import React, { useState, useEffect } from 'react';
import { SITE_LOGO_URL } from '../services/storage';

const LoadingScreen: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Progress Timer - simulates irregular loading speed
    const timer = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(timer);
          setTimeout(onComplete, 500); // Small delay at 100% before unmounting
          return 100;
        }
        // Random increment for realistic "loading" feel
        const increment = Math.random() * 10; 
        return Math.min(prev + increment, 100);
      });
    }, 150);

    return () => clearInterval(timer);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-[100] bg-brand-darker flex flex-col items-center justify-center overflow-hidden font-sans">
        <div className="relative z-10 flex flex-col items-center w-full max-w-xs px-4">
            {/* Logo */}
            <div className="mb-8">
                <img src={SITE_LOGO_URL} alt="Logo" className="w-24 h-24 md:w-32 md:h-32 object-contain" />
            </div>

            {/* Progress Bar Container */}
            <div className="w-full h-1.5 bg-gray-900 rounded-none overflow-hidden relative shadow-inner">
                <div 
                    className="h-full bg-brand-accent relative transition-all duration-200 ease-out shadow-[0_0_15px_#e84393]"
                    style={{ width: `${progress}%` }}
                >
                    <div className="absolute right-0 top-0 h-full w-4 bg-white/80 blur-[2px]"></div>
                </div>
            </div>
        </div>
    </div>
  );
};

export default LoadingScreen;
