import React from 'react';
import { Slot } from '../types';
import { Star } from 'lucide-react';

interface SlotBubbleProps {
  slot: Slot;
  isSelected: boolean;
  onClick: () => void;
}

export const SlotBubble: React.FC<SlotBubbleProps> = ({ slot, isSelected, onClick }) => {
  const { date, time, isNextAvailable } = slot;

  return (
    <button
      onClick={onClick}
      type="button"
      aria-pressed={isSelected}
      aria-label={`${date} at ${time}${isNextAvailable ? ', Next available' : ''}`}
      className={`
        relative group flex flex-col items-center justify-center
        py-2 px-1 w-full min-h-[60px]
        rounded-2xl transition-all duration-200 ease-out
        border select-none
        ${isSelected 
          ? 'bg-indigo-50 border-indigo-500 ring-2 ring-indigo-200 ring-offset-1 z-10 scale-[0.98]' 
          : 'bg-gradient-to-br from-white to-gray-50 border-gray-200 hover:border-gray-300 hover:shadow-md hover:-translate-y-0.5 hover:to-white active:scale-95'
        }
        ${isNextAvailable && !isSelected ? 'ring-1 ring-amber-100 border-amber-200 bg-gradient-to-br from-amber-50/30 to-white' : ''}
      `}
    >
      {/* Subtle top inner highlight for "glassy" 3D feel */}
      <div className={`absolute inset-x-3 top-0 h-[1px] bg-white rounded-full transition-opacity ${isSelected ? 'opacity-0' : 'opacity-70'}`} />

      {/* Next Available Badge */}
      {isNextAvailable && (
        <div className={`
          absolute -top-3 left-1/2 -translate-x-1/2 
          bg-white border px-2 py-0.5 rounded-full flex items-center gap-0.5 shadow-sm 
          transform transition-all duration-300 z-20 whitespace-nowrap
          ${isSelected ? 'border-indigo-200 text-indigo-600' : 'border-amber-200 text-amber-700'}
        `}>
          {/* Shimmer effect container */}
          <div className="absolute inset-0 rounded-full overflow-hidden">
             <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-transparent via-white/60 to-transparent -translate-x-full animate-[shimmer_2s_infinite]"></div>
          </div>

          <Star className="w-2.5 h-2.5 fill-current relative z-10" />
          <span className="text-[9px] font-bold uppercase tracking-wider leading-none relative z-10">Top</span>
        </div>
      )}

      {/* Date */}
      <span className={`
        text-[11px] font-medium tracking-wide mb-0.5 uppercase
        ${isSelected ? 'text-indigo-800' : 'text-gray-400 group-hover:text-gray-600'}
      `}>
        {date.split(' ')[0]} <span className="opacity-75">{date.split(' ').slice(1).join(' ')}</span>
      </span>

      {/* Time */}
      <span className={`
        text-[15px] font-bold leading-none tracking-tight
        ${isSelected ? 'text-indigo-600' : 'text-gray-900'}
      `}>
        {time}
      </span>
      
      {/* Active state indicator dot */}
      {isSelected && (
        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-indigo-500 rounded-full" />
      )}
    </button>
  );
};