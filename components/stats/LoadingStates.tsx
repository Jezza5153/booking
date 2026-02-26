import React from 'react'

export const LoadingSkeleton: React.FC = () => (
    <div className="p-5 space-y-5 animate-pulse">
        {/* Hero KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 h-28">
                    <div className="h-3 bg-gray-200 rounded w-20 mb-3" />
                    <div className="h-7 bg-gray-200 rounded w-28 mb-2" />
                    <div className="h-3 bg-gray-100 rounded w-24" />
                </div>
            ))}
        </div>
        {/* Secondary KPIs */}
        <div className="grid grid-cols-3 lg:grid-cols-5 gap-3">
            {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 h-20">
                    <div className="h-2.5 bg-gray-200 rounded w-16 mb-2" />
                    <div className="h-5 bg-gray-200 rounded w-12" />
                </div>
            ))}
        </div>
        {/* Chart */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="h-4 bg-gray-200 rounded w-24 mb-4" />
            <div className="h-60 bg-gray-100 rounded" />
        </div>
    </div>
)

export const ErrorState: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
    <div className="p-12 text-center">
        <div className="text-4xl mb-3">⚠️</div>
        <div className="text-base font-medium text-gray-700 mb-2">Laden mislukt</div>
        <div className="text-sm text-gray-500 mb-4">Er was een probleem bij het ophalen van de data</div>
        <button onClick={onRetry} className="px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors" style={{ minHeight: 44 }}>
            Opnieuw proberen
        </button>
    </div>
)

export const EmptyState: React.FC<{ message?: string }> = ({ message }) => (
    <div className="p-12 text-center">
        <div className="text-4xl mb-3">📊</div>
        <div className="text-base font-medium text-gray-700 mb-2">Geen data voor deze periode</div>
        <div className="text-sm text-gray-500">{message || 'Selecteer een andere periode of voeg boekingen toe'}</div>
    </div>
)
