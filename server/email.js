import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Resend (optional - sends emails only if RESEND_API_KEY is set)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Admin notification email
const ADMIN_EMAIL = process.env.BOOKING_NOTIFICATION_EMAIL || 'reserveren@tafelaaramersfoort.nl';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'bookings@tafelaaramersfoort.nl';

export async function sendBookingConfirmation({
    customerEmail,
    eventTitle,
    slotTime,
    slotDate,
    guestCount,
    tableType,
    zoneName,
}) {
    if (!resend) {
        console.log('📧 Resend not configured - skipping emails');
        return { success: false, reason: 'Resend not configured' };
    }

    const bookingDetails = `
        Event: ${eventTitle}
        Date & Time: ${slotDate} at ${slotTime}
        Table: ${tableType}-person table
        Guests: ${guestCount}
        Zone: ${zoneName}
    `.trim();

    try {
        // Send confirmation to customer (if email provided)
        if (customerEmail) {
            await resend.emails.send({
                from: FROM_EMAIL,
                to: customerEmail,
                subject: `Booking Confirmed - ${eventTitle}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f0f0f; color: #fff; padding: 40px; border-radius: 16px;">
                        <div style="text-align: center; margin-bottom: 30px;">
                            <div style="display: inline-block; background: linear-gradient(135deg, #c9a227, #a08020); color: #0f0f0f; font-weight: bold; padding: 12px 16px; border-radius: 8px; font-size: 18px;">E</div>
                            <h1 style="color: #c9a227; margin: 15px 0 5px;">Booking Confirmed!</h1>
                            <p style="color: #888; margin: 0;">You're all set 🎉</p>
                        </div>
                        
                        <div style="background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                            <h2 style="color: #c9a227; margin: 0 0 15px; font-size: 20px;">${eventTitle}</h2>
                            <p style="margin: 8px 0; color: #ccc;"><strong style="color: #c9a227;">📅</strong> ${slotDate}</p>
                            <p style="margin: 8px 0; color: #ccc;"><strong style="color: #c9a227;">🕐</strong> ${slotTime}</p>
                            <p style="margin: 8px 0; color: #ccc;"><strong style="color: #c9a227;">👥</strong> ${guestCount} guests</p>
                            <p style="margin: 8px 0; color: #ccc;"><strong style="color: #c9a227;">🪑</strong> ${tableType}-person table</p>
                            <p style="margin: 8px 0; color: #ccc;"><strong style="color: #c9a227;">📍</strong> ${zoneName}</p>
                        </div>
                        
                        <p style="color: #888; font-size: 14px; text-align: center;">
                            See you soon!<br>
                            <strong style="color: #c9a227;">De Tafelaar</strong>
                        </p>
                    </div>
                `,
            });
            console.log(`📧 Customer confirmation sent to ${customerEmail}`);
        }

        // Send notification to admin
        await resend.emails.send({
            from: FROM_EMAIL,
            to: ADMIN_EMAIL,
            subject: `New Booking: ${guestCount} guests for ${eventTitle}`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2>New Booking Received</h2>
                    <p><strong>Event:</strong> ${eventTitle}</p>
                    <p><strong>Date/Time:</strong> ${slotDate} at ${slotTime}</p>
                    <p><strong>Guests:</strong> ${guestCount}</p>
                    <p><strong>Table:</strong> ${tableType}-person</p>
                    <p><strong>Zone:</strong> ${zoneName}</p>
                    <p><strong>Customer Email:</strong> ${customerEmail || 'Not provided'}</p>
                </div>
            `,
        });
        console.log(`📧 Admin notification sent to ${ADMIN_EMAIL}`);

        return { success: true };
    } catch (error) {
        console.error('📧 Email sending failed:', error.message);
        return { success: false, reason: error.message };
    }
}
