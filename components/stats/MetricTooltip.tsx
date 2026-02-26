import React from 'react'
import { METRIC_DEFINITIONS } from './types'

interface Props { metricKey: string; children: React.ReactNode }

export const MetricTooltip: React.FC<Props> = ({ metricKey, children }) => {
    const def = METRIC_DEFINITIONS[metricKey]
    if (!def) return <>{children}</>

    return (
        <span className="relative group cursor-help">
            {children}
            <span className="pointer-events-none absolute z-50 left-0 top-full mt-1 w-64 bg-gray-900 text-white text-xs rounded-lg px-4 py-3 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                <div className="font-semibold mb-1.5">{def.label}</div>
                <div className="text-gray-300 mb-1"><span className="text-gray-400">Formule:</span> {def.formula}</div>
                <div className="text-gray-300 mb-1"><span className="text-gray-400">Omvat:</span> {def.includes}</div>
                <div className="text-gray-300"><span className="text-gray-400">Uitgezonderd:</span> {def.excludes}</div>
            </span>
        </span>
    )
}
