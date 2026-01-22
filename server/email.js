import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Resend (optional - sends emails only if RESEND_API_KEY is set)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Admin notification email - sends booking alerts to the restaurant
const ADMIN_EMAIL = process.env.BOOKING_NOTIFICATION_EMAIL || 'chef@tafelaaramersfoort.nl';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@tafelaaramersfoort.nl';

// P1-10: HTML escape helper to prevent XSS in emails
const escapeHtml = (str) => {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

export async function sendBookingConfirmation({
    customerName,
    customerEmail,
    customerPhone,
    remarks,
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
                            <p style="color: #888; margin: 0;">Bedankt, ${escapeHtml(customerName) || 'Guest'}! 🎉</p>
                        </div>
                        
                        <div style="background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                            <h2 style="color: #c9a227; margin: 0 0 15px; font-size: 20px;">${eventTitle}</h2>
                            <p style="margin: 8px 0; color: #ccc;"><strong style="color: #c9a227;">📅</strong> ${slotDate}</p>
                            <p style="margin: 8px 0; color: #ccc;"><strong style="color: #c9a227;">🕐</strong> ${slotTime}</p>
                            <p style="margin: 8px 0; color: #ccc;"><strong style="color: #c9a227;">👥</strong> ${guestCount} gasten</p>
                            <p style="margin: 8px 0; color: #ccc;"><strong style="color: #c9a227;">🪑</strong> ${tableType}-persoonstafel</p>
                            <p style="margin: 8px 0; color: #ccc;"><strong style="color: #c9a227;">📍</strong> ${zoneName}</p>
                            ${remarks ? `<p style="margin: 16px 0 8px; padding-top: 16px; border-top: 1px solid #2a2a2a; color: #888;"><strong style="color: #c9a227;">📝 Opmerkingen:</strong><br/>${escapeHtml(remarks)}</p>` : ''}
                        </div>
                        
                        <p style="color: #888; font-size: 14px; text-align: center;">
                            Tot snel!<br>
                            <strong style="color: #c9a227;">De Tafelaar</strong>
                        </p>
                    </div>
                `,
            });
            console.log(`📧 Customer confirmation sent to ${customerEmail}`);
        }

        // Send notification to admin with full customer details
        await resend.emails.send({
            from: FROM_EMAIL,
            to: ADMIN_EMAIL,
            subject: `Nieuwe Reservering: ${escapeHtml(customerName) || 'Gast'} - ${guestCount} gasten voor ${eventTitle}`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2>Nieuwe Reservering Ontvangen</h2>
                    
                    <h3 style="color: #c9a227; border-bottom: 1px solid #eee; padding-bottom: 8px;">Klant Gegevens</h3>
                    <p><strong>Naam:</strong> ${escapeHtml(customerName) || 'Niet opgegeven'}</p>
                    <p><strong>Email:</strong> ${escapeHtml(customerEmail) || 'Niet opgegeven'}</p>
                    <p><strong>Telefoon:</strong> ${escapeHtml(customerPhone) || 'Niet opgegeven'}</p>
                    ${remarks ? `<p><strong>Opmerkingen:</strong> ${escapeHtml(remarks)}</p>` : ''}
                    
                    <h3 style="color: #c9a227; border-bottom: 1px solid #eee; padding-bottom: 8px; margin-top: 24px;">Reservering Details</h3>
                    <p><strong>Event:</strong> ${eventTitle}</p>
                    <p><strong>Datum/Tijd:</strong> ${slotDate} om ${slotTime}</p>
                    <p><strong>Gasten:</strong> ${guestCount}</p>
                    <p><strong>Tafel:</strong> ${tableType}-persoons</p>
                    <p><strong>Zone:</strong> ${zoneName}</p>
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

// Email for large groups (7+) - "We will contact you" message
export async function sendLargeGroupNotification({
    customerName,
    customerEmail,
    customerPhone,
    remarks,
    eventTitle,
    slotTime,
    slotDate,
    guestCount,
    zoneName,
}) {
    if (!resend) {
        console.log('📧 Resend not configured - skipping emails');
        return { success: false, reason: 'Resend not configured' };
    }

    try {
        // Send "we will contact you" email to customer
        if (customerEmail) {
            await resend.emails.send({
                from: FROM_EMAIL,
                to: customerEmail,
                subject: `Groepsreservering Ontvangen - ${eventTitle}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f0f0f; color: #fff; padding: 40px; border-radius: 16px;">
                        <div style="text-align: center; margin-bottom: 30px;">
                            <div style="display: inline-block; background: linear-gradient(135deg, #c9a227, #a08020); color: #0f0f0f; font-weight: bold; padding: 12px 16px; border-radius: 8px; font-size: 18px;">E</div>
                            <h1 style="color: #c9a227; margin: 15px 0 5px;">Aanvraag Ontvangen!</h1>
                            <p style="color: #888; margin: 0;">Bedankt, ${escapeHtml(customerName) || 'Guest'}! 🎉</p>
                        </div>
                        
                        <div style="background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                            <h2 style="color: #c9a227; margin: 0 0 15px; font-size: 20px;">${eventTitle}</h2>
                            <p style="margin: 8px 0; color: #ccc;"><strong style="color: #c9a227;">📅</strong> ${slotDate}</p>
                            <p style="margin: 8px 0; color: #ccc;"><strong style="color: #c9a227;">🕐</strong> ${slotTime}</p>
                            <p style="margin: 8px 0; color: #ccc;"><strong style="color: #c9a227;">👥</strong> ${guestCount} gasten</p>
                            <p style="margin: 8px 0; color: #ccc;"><strong style="color: #c9a227;">📍</strong> ${zoneName}</p>
                            ${remarks ? `<p style="margin: 16px 0 8px; padding-top: 16px; border-top: 1px solid #2a2a2a; color: #888;"><strong style="color: #c9a227;">📝 Opmerkingen:</strong><br/>${escapeHtml(remarks)}</p>` : ''}
                        </div>
                        
                        <div style="background: #2a2a1a; border: 1px solid #3a3a2a; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
                            <p style="color: #c9a227; margin: 0 0 10px; font-weight: bold;">📞 Wat nu?</p>
                            <p style="color: #ccc; margin: 0;">
                                Voor groepen van ${guestCount} personen nemen we graag persoonlijk contact met je op om de beste plek te regelen.
                                <br/><br/>
                                <strong>Je wordt binnen 24 uur gebeld of gemaild.</strong>
                            </p>
                        </div>
                        
                        <p style="color: #888; font-size: 14px; text-align: center;">
                            Tot snel!<br>
                            <strong style="color: #c9a227;">De Tafelaar</strong>
                        </p>
                    </div>
                `,
            });
            console.log(`📧 Large group notification sent to ${customerEmail}`);
        }

        // Send notification to admin with PRIORITY flag
        await resend.emails.send({
            from: FROM_EMAIL,
            to: ADMIN_EMAIL,
            subject: `🔔 GROTE GROEP: ${escapeHtml(customerName) || 'Gast'} - ${guestCount} gasten voor ${eventTitle}`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <div style="background: #fff3cd; border: 1px solid #ffc107; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
                        <strong style="color: #856404;">⚠️ ACTIE VEREIST:</strong> Dit is een grote groep (${guestCount} personen). Neem contact op met de klant om te bevestigen.
                    </div>
                    
                    <h2>Groepsaanvraag Ontvangen</h2>
                    
                    <h3 style="color: #c9a227; border-bottom: 1px solid #eee; padding-bottom: 8px;">Klant Gegevens</h3>
                    <p><strong>Naam:</strong> ${escapeHtml(customerName) || 'Niet opgegeven'}</p>
                    <p><strong>Email:</strong> ${escapeHtml(customerEmail) || 'Niet opgegeven'}</p>
                    <p><strong>Telefoon:</strong> ${escapeHtml(customerPhone) || 'Niet opgegeven'}</p>
                    ${remarks ? `<p><strong>Opmerkingen:</strong> ${escapeHtml(remarks)}</p>` : ''}
                    
                    <h3 style="color: #c9a227; border-bottom: 1px solid #eee; padding-bottom: 8px; margin-top: 24px;">Reservering Details</h3>
                    <p><strong>Event:</strong> ${eventTitle}</p>
                    <p><strong>Datum/Tijd:</strong> ${slotDate} om ${slotTime}</p>
                    <p><strong>Gasten:</strong> <span style="background: #c9a227; color: #000; padding: 2px 8px; border-radius: 4px; font-weight: bold;">${guestCount}</span></p>
                    <p><strong>Zone:</strong> ${zoneName}</p>
                </div>
            `,
        });
        console.log(`📧 Large group admin notification sent to ${ADMIN_EMAIL}`);

        return { success: true };
    } catch (error) {
        console.error('📧 Large group email sending failed:', error.message);
        return { success: false, reason: error.message };
    }
}

