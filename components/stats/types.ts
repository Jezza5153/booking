// ── Dashboard Types & Constants ────────────────────────────────
export interface DayStats {
    date: string
    bookings: number
    couverts: number
    walkins: number
    noShows: number
    cancellations: number
    arrived: number
    revenue: number | null
    revenueNotes: string | null
}

export interface PrevDayStats {
    date: string
    bookings: number
    couverts: number
    revenue: number
}

export interface HeatmapCell { dow: number; hour: number; count: number }

export interface TableUtil {
    id: string; name: string; seats: number; zone: string
    booking_count: number; total_guests: number
}

export interface Comparison {
    bookings: number; couverts: number; walkins: number
    no_shows: number; cancellations: number; revenue: number
}

export interface Summary {
    bookings: number; couverts: number; revenue: number; avgPerDay: number
    walkins: number; noShows: number; cancellations: number
    noShowRate: number; cancRate: number; occupancy: number; revpash: number; activeDays: number
}

export interface ExtraStats {
    avgPartySize: number
    busiestDay: string | null
    peakHours: { hour: number; count: number }[]
    activeDays: number
}

export interface RevenueData { total: number; avg_per_couvert: number }

export interface PartySizeBucket { size: string; count: number; guests: number }
export interface LeadTimeBucket { bucket: string; count: number }

export interface MetricDetail {
    key: string
    label: string
    value: string | number
    prevValue?: string | number
    delta?: number
    explanation: string
    trendData: { label: string; value: number }[]
}

export type Tab = 'overzicht' | 'dagelijks' | 'analyse'
export type ChartMetric = 'couverts' | 'bookings' | 'revenue'
export type DatePreset = '7d' | '30d' | 'week' | 'prev_week' | 'month' | 'prev_month'

// ── Constants ──────────────────────────────────────────────────
export const ACCENT = '#2563eb'
export const ACCENT_LIGHT = '#dbeafe'

// Service capacity config — should eventually come from restaurant settings
export const SERVICE_CONFIG = {
    hoursPerDay: 11,     // 11:00 – 22:00
}

export const METRIC_DEFINITIONS: Record<string, { label: string; formula: string; includes: string; excludes: string }> = {
    occupancy: {
        label: 'Bezetting',
        formula: 'Couverts ÷ (Stoelen × Actieve dagen × Seatings per avond)',
        includes: 'Alle gearriveerde en verwachte gasten',
        excludes: 'Waarde wordt begrensd op 100% per dag'
    },
    revpash: {
        label: 'RevPASH',
        formula: 'Omzet ÷ (Stoelen × Actieve dagen × Serviceuren)',
        includes: 'Handmatig ingevoerde omzet, alle stoelen',
        excludes: 'Geen uitsplitsing lunch/diner'
    },
    repeatRate: {
        label: 'Herhaalbezoek',
        formula: 'Gasten met >1 boeking ÷ Totaal unieke gasten',
        includes: 'Op basis van e-mailadres (genormaliseerd)',
        excludes: 'Gasten zonder e-mail, walk-ins zonder registratie'
    },
    noShowRate: {
        label: 'No-show rate',
        formula: 'No-shows ÷ Totaal boekingen × 100',
        includes: 'Alle boekingen met status "no_show"',
        excludes: 'Geannuleerde boekingen'
    },
    cancRate: {
        label: 'Annuleringspercentage',
        formula: 'Annuleringen ÷ Totaal boekingen × 100',
        includes: 'Alle boekingen met status "cancelled"',
        excludes: 'No-shows (apart geteld)'
    },
    avgSpend: {
        label: 'Gem. besteding',
        formula: 'Totaal omzet ÷ Totaal couverts',
        includes: 'Handmatige omzet invoer per dag',
        excludes: 'Dagen zonder omzet ingevoerd'
    }
}

export const LEAD_TIME_LABELS: Record<string, string> = {
    same_day: 'Zelfde dag',
    '1_day': '1 dag',
    '2_3_days': '2-3 dagen',
    '4_7_days': '4-7 dagen',
    '8_plus': '8+ dagen',
}
