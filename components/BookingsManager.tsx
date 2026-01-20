import React, { useState, useEffect, useMemo } from 'react';
import {
    Search,
    Calendar,
    Filter,
    Download,
    X,
    User,
    Phone,
    Mail,
    MessageSquare,
    Users,
    Clock,
    MapPin,
    AlertTriangle,
    RefreshCw,
    ChevronDown,
} from 'lucide-react';
import { BookingRow } from '../types';
import { fetchBookings, cancelBooking, RESTAURANT_ID } from '../api';

const TZ = 'Europe/Amsterdam';

function formatDateDutch(isoString: string) {
    const dt = new Date(isoString);
    return new Intl.DateTimeFormat('nl-NL', {
        timeZone: TZ,
        weekday: 'short',
        day: '2-digit',
        month: 'short',
    }).format(dt);
}

function formatTimeDutch(isoString: string) {
    const dt = new Date(isoString);
    return new Intl.DateTimeFormat('nl-NL', {
        timeZone: TZ,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(dt);
}

function formatDateInput(isoString: string) {
    const dt = new Date(isoString);
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(dt);
}

interface BookingsManagerProps {
    restaurantId?: string;
}

export const BookingsManager: React.FC<BookingsManagerProps> = ({
    restaurantId = RESTAURANT_ID,
}) => {
    const [bookings, setBookings] = useState<BookingRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Filters
    const [search, setSearch] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'confirmed' | 'cancelled'>('confirmed');

    // Modal states
    const [selectedBooking, setSelectedBooking] = useState<BookingRow | null>(null);
    const [cancelConfirm, setCancelConfirm] = useState<BookingRow | null>(null);
    const [cancelling, setCancelling] = useState(false);

    const loadBookings = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchBookings({
                restaurantId,
                from: fromDate || undefined,
                to: toDate || undefined,
                status: statusFilter === 'all' ? undefined : statusFilter,
                q: search || undefined,
            });
            setBookings(data);
        } catch (err: any) {
            setError(err.message || 'Laden mislukt');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadBookings();
    }, [restaurantId, fromDate, toDate, statusFilter]);

    // Debounced search
    useEffect(() => {
        const timer = setTimeout(() => {
            loadBookings();
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);

    const handleCancel = async (booking: BookingRow) => {
        setCancelling(true);
        try {
            await cancelBooking(booking.id);
            setCancelConfirm(null);
            await loadBookings();
        } catch (err: any) {
            alert(err.message || 'Annuleren mislukt');
        } finally {
            setCancelling(false);
        }
    };

    const handleExportCSV = () => {
        const headers = ['Datum', 'Tijd', 'Naam', 'Email', 'Telefoon', 'Gasten', 'Tafel', 'Event', 'Zone', 'Status', 'Opmerkingen'];
        const rows = bookings.map((b) => [
            formatDateDutch(b.start_datetime),
            formatTimeDutch(b.start_datetime),
            b.customer_name,
            b.customer_email || '',
            b.customer_phone || '',
            b.guest_count,
            b.table_type + 'p',
            b.event_title,
            b.zone_name,
            b.status === 'confirmed' ? 'Bevestigd' : 'Geannuleerd',
            (b.remarks || '').replace(/"/g, '""'),
        ]);

        const csv = [
            headers.join(','),
            ...rows.map((r) => r.map((v) => `"${v}"`).join(',')),
        ].join('\n');

        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `boekingen-${formatDateInput(new Date().toISOString())}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const clearFilters = () => {
        setSearch('');
        setFromDate('');
        setToDate('');
        setStatusFilter('confirmed');
    };

    const hasFilters = search || fromDate || toDate || statusFilter !== 'confirmed';

    return (
        <div className="flex h-[calc(100vh-80px)] bg-white max-w-7xl mx-auto border-x border-gray-200 shadow-xl shadow-gray-100 overflow-hidden">
            {/* Sidebar */}
            <div className="w-72 bg-gray-50 border-r border-gray-200 flex flex-col p-4">
                <div className="mb-6 px-2">
                    <div className="flex items-center gap-2 text-gray-900 font-extrabold">
                        <Users className="w-5 h-5 text-[#c9a227]" />
                        <span>Boekingen</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">Overzicht van alle reserveringen</div>
                </div>

                <div className="space-y-4 px-1">
                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Zoek naam, email, telefoon..."
                            className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#c9a227]/30 focus:border-[#c9a227]"
                        />
                    </div>

                    {/* Date filters */}
                    <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-3">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                            <Calendar className="w-4 h-4" />
                            Periode
                        </div>
                        <div className="space-y-2">
                            <div>
                                <label className="text-[11px] text-gray-500">Vanaf</label>
                                <input
                                    type="date"
                                    value={fromDate}
                                    onChange={(e) => setFromDate(e.target.value)}
                                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#c9a227]/30"
                                />
                            </div>
                            <div>
                                <label className="text-[11px] text-gray-500">Tot</label>
                                <input
                                    type="date"
                                    value={toDate}
                                    onChange={(e) => setToDate(e.target.value)}
                                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#c9a227]/30"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Status filter */}
                    <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                            <Filter className="w-4 h-4" />
                            Status
                        </div>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as any)}
                            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#c9a227]/30"
                        >
                            <option value="confirmed">Alleen bevestigd</option>
                            <option value="cancelled">Alleen geannuleerd</option>
                            <option value="all">Alles</option>
                        </select>
                    </div>

                    {/* Clear filters */}
                    {hasFilters && (
                        <button
                            onClick={clearFilters}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition"
                        >
                            <X className="w-4 h-4" />
                            Filters wissen
                        </button>
                    )}
                </div>

                {/* Export & Refresh */}
                <div className="mt-auto pt-6 space-y-2 px-1">
                    <button
                        onClick={handleExportCSV}
                        disabled={bookings.length === 0}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-800 hover:border-gray-300 transition disabled:opacity-50"
                    >
                        <Download className="w-4 h-4" />
                        Exporteer CSV
                    </button>
                    <button
                        onClick={loadBookings}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#c9a227] hover:bg-[#d4af37] text-[#0b0b0b] rounded-xl text-sm font-extrabold transition"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        Vernieuwen
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Header */}
                <div className="h-16 border-b border-gray-200 flex items-center justify-between px-6 bg-white">
                    <div className="flex items-center gap-3">
                        <h2 className="text-lg font-extrabold text-gray-900">Reserveringen</h2>
                        <span className="text-xs font-semibold bg-gray-100 border border-gray-200 px-2 py-1 rounded-full text-gray-600">
                            {bookings.length} boekingen
                        </span>
                        {statusFilter === 'confirmed' && (
                            <span className="text-xs font-semibold bg-green-100 border border-green-200 px-2 py-1 rounded-full text-green-700">
                                bevestigd
                            </span>
                        )}
                    </div>
                </div>

                {/* Table */}
                <div className="flex-1 overflow-auto">
                    {loading && bookings.length === 0 ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="animate-pulse text-gray-400">Laden...</div>
                        </div>
                    ) : error ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-red-500">{error}</div>
                        </div>
                    ) : bookings.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-gray-500">
                            Geen boekingen gevonden
                        </div>
                    ) : (
                        <table className="w-full">
                            <thead className="bg-gray-50 sticky top-0">
                                <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                    <th className="px-6 py-3">Datum</th>
                                    <th className="px-4 py-3">Tijd</th>
                                    <th className="px-4 py-3">Naam</th>
                                    <th className="px-4 py-3 hidden md:table-cell">Gasten</th>
                                    <th className="px-4 py-3 hidden lg:table-cell">Tafel</th>
                                    <th className="px-4 py-3 hidden xl:table-cell">Event</th>
                                    <th className="px-4 py-3 hidden lg:table-cell">Zone</th>
                                    <th className="px-4 py-3">Status</th>
                                    <th className="px-4 py-3 text-right">Acties</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {bookings.map((booking) => (
                                    <tr
                                        key={booking.id}
                                        className={`hover:bg-gray-50 ${booking.status === 'cancelled' ? 'opacity-60' : ''}`}
                                    >
                                        <td className="px-6 py-4 text-sm font-medium text-gray-900">
                                            {formatDateDutch(booking.start_datetime)}
                                        </td>
                                        <td className="px-4 py-4 text-sm font-mono text-gray-700">
                                            {formatTimeDutch(booking.start_datetime)}
                                        </td>
                                        <td className="px-4 py-4">
                                            <div className="text-sm font-semibold text-gray-900">{booking.customer_name}</div>
                                            {booking.remarks && (
                                                <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                                                    <MessageSquare className="w-3 h-3" />
                                                    <span className="truncate max-w-[120px]">{booking.remarks}</span>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-4 hidden md:table-cell">
                                            <div className="flex items-center gap-1 text-sm text-gray-700">
                                                <Users className="w-4 h-4 text-gray-400" />
                                                {booking.guest_count}
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 hidden lg:table-cell">
                                            <span className="inline-flex items-center px-2 py-1 bg-gray-100 rounded-lg text-xs font-medium text-gray-700">
                                                {booking.table_type}p
                                            </span>
                                        </td>
                                        <td className="px-4 py-4 hidden xl:table-cell text-sm text-gray-700">
                                            {booking.event_title}
                                        </td>
                                        <td className="px-4 py-4 hidden lg:table-cell text-sm text-gray-500">
                                            {booking.zone_name}
                                        </td>
                                        <td className="px-4 py-4">
                                            <span
                                                className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${booking.status === 'confirmed'
                                                        ? 'bg-green-100 text-green-700'
                                                        : 'bg-red-100 text-red-700'
                                                    }`}
                                            >
                                                {booking.status === 'confirmed' ? 'Bevestigd' : 'Geannuleerd'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-4 text-right space-x-2">
                                            <button
                                                onClick={() => setSelectedBooking(booking)}
                                                className="text-sm font-semibold text-[#7a5e14] hover:text-[#c9a227]"
                                            >
                                                Details
                                            </button>
                                            {booking.status === 'confirmed' && (
                                                <button
                                                    onClick={() => setCancelConfirm(booking)}
                                                    className="text-sm font-semibold text-red-600 hover:text-red-700"
                                                >
                                                    Annuleren
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {/* Detail Modal */}
            {selectedBooking && (
                <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-5">
                        <div className="flex items-start justify-between">
                            <div>
                                <h3 className="text-lg font-extrabold text-gray-900">{selectedBooking.customer_name}</h3>
                                <p className="text-sm text-gray-500">
                                    {formatDateDutch(selectedBooking.start_datetime)} om {formatTimeDutch(selectedBooking.start_datetime)}
                                </p>
                            </div>
                            <button
                                onClick={() => setSelectedBooking(null)}
                                className="p-1 hover:bg-gray-100 rounded-lg transition"
                            >
                                <X className="w-5 h-5 text-gray-500" />
                            </button>
                        </div>

                        <div className="border-t border-gray-100 pt-4 space-y-3">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-gray-100 rounded-xl flex items-center justify-center">
                                    <Calendar className="w-4 h-4 text-gray-600" />
                                </div>
                                <div>
                                    <div className="text-[11px] text-gray-400 uppercase">Event</div>
                                    <div className="font-semibold text-gray-900">{selectedBooking.event_title}</div>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-gray-100 rounded-xl flex items-center justify-center">
                                    <MapPin className="w-4 h-4 text-gray-600" />
                                </div>
                                <div>
                                    <div className="text-[11px] text-gray-400 uppercase">Zone</div>
                                    <div className="font-semibold text-gray-900">{selectedBooking.zone_name}</div>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-[#c9a227]/15 rounded-xl flex items-center justify-center">
                                    <Users className="w-4 h-4 text-[#7a5e14]" />
                                </div>
                                <div>
                                    <div className="text-[11px] text-gray-400 uppercase">Reservering</div>
                                    <div className="font-semibold text-gray-900">
                                        {selectedBooking.guest_count} gasten • tafel voor {selectedBooking.table_type}
                                    </div>
                                </div>
                            </div>

                            {selectedBooking.customer_email && (
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 bg-gray-100 rounded-xl flex items-center justify-center">
                                        <Mail className="w-4 h-4 text-gray-600" />
                                    </div>
                                    <div>
                                        <div className="text-[11px] text-gray-400 uppercase">Email</div>
                                        <div className="font-semibold text-gray-900">{selectedBooking.customer_email}</div>
                                    </div>
                                </div>
                            )}

                            {selectedBooking.customer_phone && (
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 bg-gray-100 rounded-xl flex items-center justify-center">
                                        <Phone className="w-4 h-4 text-gray-600" />
                                    </div>
                                    <div>
                                        <div className="text-[11px] text-gray-400 uppercase">Telefoon</div>
                                        <div className="font-semibold text-gray-900">{selectedBooking.customer_phone}</div>
                                    </div>
                                </div>
                            )}

                            {selectedBooking.remarks && (
                                <div className="flex items-start gap-3">
                                    <div className="w-9 h-9 bg-yellow-100 rounded-xl flex items-center justify-center flex-shrink-0">
                                        <MessageSquare className="w-4 h-4 text-yellow-700" />
                                    </div>
                                    <div>
                                        <div className="text-[11px] text-gray-400 uppercase">Opmerkingen</div>
                                        <div className="text-sm text-gray-700">{selectedBooking.remarks}</div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3 pt-2">
                            {selectedBooking.status === 'confirmed' && (
                                <button
                                    onClick={() => {
                                        setSelectedBooking(null);
                                        setCancelConfirm(selectedBooking);
                                    }}
                                    className="flex-1 bg-red-100 hover:bg-red-200 text-red-700 py-3 rounded-xl font-extrabold transition"
                                >
                                    Annuleren
                                </button>
                            )}
                            <button
                                onClick={() => setSelectedBooking(null)}
                                className="flex-1 bg-[#c9a227] hover:bg-[#d4af37] text-[#0b0b0b] py-3 rounded-xl font-extrabold transition"
                            >
                                Sluiten
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Cancel Confirm Modal */}
            {cancelConfirm && (
                <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-5">
                        <div className="text-center">
                            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <AlertTriangle className="w-8 h-8 text-red-600" />
                            </div>
                            <h3 className="text-xl font-extrabold text-gray-900">Boeking annuleren?</h3>
                            <p className="text-sm text-gray-500 mt-2">
                                Weet je zeker dat je de reservering van <strong>{cancelConfirm.customer_name}</strong> wilt annuleren?
                            </p>
                        </div>

                        <div className="bg-gray-50 rounded-xl p-4 text-sm">
                            <div className="text-gray-600">
                                {formatDateDutch(cancelConfirm.start_datetime)} om {formatTimeDutch(cancelConfirm.start_datetime)}
                            </div>
                            <div className="text-gray-800 font-semibold">
                                {cancelConfirm.guest_count} gasten • {cancelConfirm.event_title}
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setCancelConfirm(null)}
                                disabled={cancelling}
                                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 py-3 rounded-xl font-extrabold transition"
                            >
                                Terug
                            </button>
                            <button
                                onClick={() => handleCancel(cancelConfirm)}
                                disabled={cancelling}
                                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-extrabold transition disabled:opacity-50"
                            >
                                {cancelling ? 'Bezig...' : 'Annuleren'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
