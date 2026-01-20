import React from 'react'
import { Slot, Wijk } from '../types'
import { Star, AlertCircle } from 'lucide-react'

interface SlotBubbleProps {
  slot: Slot
  isSelected: boolean
  onClick: () => void
  wijk?: Wijk // optional, for "bijna vol" indicator
}

export const SlotBubble: React.FC<SlotBubbleProps> = ({ slot, isSelected, onClick, wijk }) => {
  const { date, time, isNextAvailable } = slot

  // Calculate availability for "bijna vol" indicator
  const totalCapacity = wijk
    ? (wijk.count2tops + wijk.count4tops + wijk.count6tops)
    : 0
  const totalBooked = slot.booked2tops + slot.booked4tops + slot.booked6tops
  const fillRatio = totalCapacity > 0 ? totalBooked / totalCapacity : 0
  const isAlmostFull = fillRatio >= 0.7 && fillRatio < 1
  const isFull = totalCapacity > 0 && totalBooked >= totalCapacity

  // Format date for display (handles both ISO and Dutch formats)
  const displayDate = date?.match(/^\d{4}-\d{2}-\d{2}/)
    ? new Date(date).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })
    : date

  const dateParts = displayDate?.split(' ') || []
  const weekday = dateParts[0] || ''
  const dayMonth = dateParts.slice(1).join(' ') || ''

  return (
    <button
      onClick={onClick}
      type="button"
      disabled={isFull}
      aria-pressed={isSelected}
      aria-label={`${displayDate} om ${time}${isNextAvailable ? ', aanbevolen' : ''}${isFull ? ', vol' : ''}`}
      className={[
        "relative group flex flex-col items-center justify-center",
        "py-2.5 px-2 w-full min-h-[64px]",
        "rounded-xl transition-all duration-200 ease-out",
        "border select-none",
        isFull
          ? "opacity-40 cursor-not-allowed bg-white/[0.02] border-white/10"
          : isSelected
            ? "bg-[#c9a227]/15 border-[#c9a227]/60 ring-2 ring-[#c9a227]/25 z-10 scale-[0.98]"
            : "bg-white/[0.03] border-white/10 hover:border-[#c9a227]/40 hover:bg-white/[0.05] active:scale-95",
        isNextAvailable && !isSelected && !isFull
          ? "ring-1 ring-[#c9a227]/30 border-[#c9a227]/30"
          : "",
      ].join(" ")}
    >
      {/* Next Available Badge */}
      {isNextAvailable && !isFull && (
        <div
          className={[
            "absolute -top-2.5 left-1/2 -translate-x-1/2",
            "px-2 py-0.5 rounded-full flex items-center gap-1",
            "text-[9px] font-bold uppercase tracking-wider",
            "border shadow-sm z-20 whitespace-nowrap",
            isSelected
              ? "bg-[#c9a227] text-[#0b0b0b] border-[#c9a227]"
              : "bg-[#c9a227]/20 text-[#c9a227] border-[#c9a227]/40",
          ].join(" ")}
        >
          <Star className="w-2.5 h-2.5 fill-current" />
          <span>Top</span>
        </div>
      )}

      {/* Almost Full Indicator */}
      {isAlmostFull && !isSelected && !isFull && (
        <div className="absolute -top-2 right-1 flex items-center gap-0.5 text-[9px] text-orange-300/80">
          <AlertCircle className="w-2.5 h-2.5" />
          <span className="font-medium">Bijna vol</span>
        </div>
      )}

      {/* Full Indicator */}
      {isFull && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] font-bold text-white/50 uppercase tracking-wider">Vol</span>
        </div>
      )}

      {/* Date */}
      {!isFull && (
        <>
          <span
            className={[
              "text-[10px] font-medium tracking-wide uppercase",
              isSelected ? "text-[#c9a227]" : "text-white/50 group-hover:text-white/70",
            ].join(" ")}
          >
            {weekday} <span className="opacity-75">{dayMonth}</span>
          </span>

          {/* Time */}
          <span
            className={[
              "text-[15px] font-bold leading-tight tracking-tight mt-0.5",
              isSelected ? "text-[#c9a227]" : "text-white",
            ].join(" ")}
          >
            {time}
          </span>
        </>
      )}

      {/* Selected indicator dot */}
      {isSelected && (
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-[#c9a227] rounded-full shadow-sm shadow-[#c9a227]/50" />
      )}
    </button>
  )
}