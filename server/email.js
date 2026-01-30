import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Resend (optional - sends emails only if RESEND_API_KEY is set)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Admin notification email - sends booking alerts to the restaurant
const ADMIN_EMAIL = process.env.BOOKING_NOTIFICATION_EMAIL || 'reserveren@tafelaaramersfoort.nl';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@tafelaaramersfoort.nl';
const REPLY_TO_EMAIL = 'reserveren@tafelaaramersfoort.nl';
const PHONE_NUMBER = '+31 6 341 279 32';

// HTML escape helper to prevent XSS in emails
const escapeHtml = (str) => {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

// ============================================
// EVENT BOOKING CONFIRMATION (1-6 guests)
// ============================================
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
        // Customer confirmation email
        if (customerEmail) {
            await resend.emails.send({
                from: FROM_EMAIL,
                to: customerEmail,
                replyTo: REPLY_TO_EMAIL,
                subject: `Je reservering staat! 🎉`,
                html: `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; background: #0f0f0f; color: #fff; padding: 32px; border-radius: 16px;">
                        <p style="color: #fff; font-size: 16px; margin: 0 0 20px;">Hi ${escapeHtml(customerName) || 'daar'},</p>
                        
                        <p style="color: #fff; font-size: 18px; margin: 0 0 24px;">
                            <strong>Yes, je reservering staat!</strong> 🎉
                        </p>
                        
                        <div style="background: #1a1a1a; border-left: 3px solid #c9a227; padding: 16px 20px; margin: 0 0 24px; border-radius: 0 8px 8px 0;">
                            <p style="color: #c9a227; font-weight: bold; margin: 0 0 8px; font-size: 16px;">${escapeHtml(eventTitle)}</p>
                            <p style="color: #ccc; margin: 0; font-size: 14px;">
                                📅 ${escapeHtml(slotDate)} • 🕐 ${escapeHtml(slotTime)} • 👥 ${guestCount} ${guestCount === 1 ? 'persoon' : 'personen'}
                            </p>
                        </div>
                        
                        <p style="color: #888; font-size: 14px; margin: 0 0 24px; line-height: 1.5;">
                            Iets doorgeven (allergieën/wensen) of wijzigen?<br>
                            Antwoord op deze mail of app/bel ons: <strong style="color: #fff;">${PHONE_NUMBER}</strong>
                        </p>
                        
                        <p style="color: #888; font-size: 14px; margin: 0;">
                            Tot snel!<br>
                            <strong style="color: #c9a227;">De Tafelaar</strong>
                        </p>
                    </div>
                `,
            });
            console.log(`📧 Event confirmation sent to ${customerEmail}`);
        }

        // Admin notification
        await resend.emails.send({
            from: FROM_EMAIL,
            to: ADMIN_EMAIL,
            subject: `📋 ${escapeHtml(customerName) || 'Gast'} - ${guestCount}p - ${escapeHtml(eventTitle)}`,
            html: `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; max-width: 500px;">
                    <h2 style="margin: 0 0 16px; font-size: 18px; color: #333;">NIEUWE EVENTBOEKING</h2>
                    
                    <p style="margin: 4px 0; color: #333;"><strong>Naam:</strong> ${escapeHtml(customerName) || 'Niet opgegeven'}</p>
                    <p style="margin: 4px 0; color: #333;">📧 ${escapeHtml(customerEmail) || '-'}</p>
                    <p style="margin: 4px 0; color: #333;">📞 ${escapeHtml(customerPhone) || '-'}</p>
                    
                    <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
                    
                    <p style="margin: 4px 0; color: #333;"><strong>Event:</strong> ${escapeHtml(eventTitle)}</p>
                    <p style="margin: 4px 0; color: #333;">📅 ${escapeHtml(slotDate)} • 🕐 ${escapeHtml(slotTime)} • 👥 ${guestCount}</p>
                    
                    <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
                    
                    <p style="margin: 4px 0; color: #666;"><strong>Opmerking:</strong> ${escapeHtml(remarks) || 'Geen'}</p>
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

// ============================================
// LARGE GROUP EVENT NOTIFICATION (7+ guests)
// ============================================
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
        // Customer email for large groups
        if (customerEmail) {
            await resend.emails.send({
                from: FROM_EMAIL,
                to: customerEmail,
                replyTo: REPLY_TO_EMAIL,
                subject: `Groepsaanvraag ontvangen - ${escapeHtml(eventTitle)}`,
                html: `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; background: #0f0f0f; color: #fff; padding: 32px; border-radius: 16px;">
                        <p style="color: #fff; font-size: 16px; margin: 0 0 20px;">Hi ${escapeHtml(customerName) || 'daar'},</p>
                        
                        <p style="color: #fff; font-size: 18px; margin: 0 0 24px;">
                            <strong>Dankjewel! We hebben je groepsaanvraag goed ontvangen.</strong>
                        </p>
                        
                        <div style="background: #1a1a1a; border-left: 3px solid #c9a227; padding: 16px 20px; margin: 0 0 24px; border-radius: 0 8px 8px 0;">
                            <p style="color: #c9a227; font-weight: bold; margin: 0 0 8px; font-size: 16px;">${escapeHtml(eventTitle)}</p>
                            <p style="color: #ccc; margin: 0; font-size: 14px;">
                                📅 ${escapeHtml(slotDate)} • 🕐 ${escapeHtml(slotTime)} • 👥 ${guestCount} personen
                            </p>
                        </div>
                        
                        <p style="color: #fff; font-size: 14px; margin: 0 0 16px;">
                            We nemen snel contact met je op om alles af te stemmen.
                        </p>
                        
                        <p style="color: #888; font-size: 14px; margin: 0 0 16px;">
                            Je gegevens die we hebben:<br>
                            📧 ${escapeHtml(customerEmail)} • 📞 ${escapeHtml(customerPhone) || '-'}
                        </p>
                        
                        <p style="color: #888; font-size: 14px; margin: 0 0 24px; line-height: 1.5;">
                            Wil je alvast iets doorgeven?<br>
                            Antwoord op deze mail of app/bel: <strong style="color: #fff;">${PHONE_NUMBER}</strong>
                        </p>
                        
                        <p style="color: #888; font-size: 14px; margin: 0;">
                            <strong style="color: #c9a227;">De Tafelaar</strong>
                        </p>
                    </div>
                `,
            });
            console.log(`📧 Large group confirmation sent to ${customerEmail}`);
        }

        // Admin notification - priority flag
        await resend.emails.send({
            from: FROM_EMAIL,
            to: ADMIN_EMAIL,
            subject: `⚠️ GROEP: ${escapeHtml(customerName) || 'Gast'} - ${guestCount}p`,
            html: `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; max-width: 500px;">
                    <div style="background: #fff3cd; border: 1px solid #ffc107; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px;">
                        <strong style="color: #856404;">⚠️ GROTE GROEP (OPVOLGEN)</strong>
                    </div>
                    
                    <p style="margin: 4px 0; color: #333;"><strong>Naam:</strong> ${escapeHtml(customerName) || 'Niet opgegeven'}</p>
                    <p style="margin: 4px 0; color: #333;">📧 ${escapeHtml(customerEmail) || '-'}</p>
                    <p style="margin: 4px 0; color: #333;">📞 ${escapeHtml(customerPhone) || '-'}</p>
                    
                    <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
                    
                    <p style="margin: 4px 0; color: #333;"><strong>Event:</strong> ${escapeHtml(eventTitle)}</p>
                    <p style="margin: 4px 0; color: #333;">📅 ${escapeHtml(slotDate)} • 🕐 ${escapeHtml(slotTime)} • 👥 <span style="background: #c9a227; color: #000; padding: 2px 8px; border-radius: 4px; font-weight: bold;">${guestCount}</span></p>
                    
                    <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
                    
                    <p style="margin: 4px 0; color: #666;"><strong>Opmerking:</strong> ${escapeHtml(remarks) || 'Geen'}</p>
                    
                    <p style="margin: 16px 0 0; color: #856404; font-weight: bold;">
                        Actie: neem contact op om details af te stemmen.
                    </p>
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

// ============================================
// RESTAURANT BOOKING CONFIRMATION (1-6 guests)
// ============================================
export async function sendRestaurantBookingConfirmation({
    customerName,
    customerEmail,
    customerPhone,
    remarks,
    tableName,
    bookingDate,
    bookingTime,
    guestCount,
}) {
    if (!resend) {
        console.log('📧 Resend not configured - skipping emails');
        return { success: false, reason: 'Resend not configured' };
    }

    try {
        // Customer confirmation
        if (customerEmail) {
            await resend.emails.send({
                from: FROM_EMAIL,
                to: customerEmail,
                replyTo: REPLY_TO_EMAIL,
                subject: `Tafel gereserveerd! ✨`,
                html: `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; background: #0f0f0f; color: #fff; padding: 32px; border-radius: 16px;">
                        <p style="color: #fff; font-size: 16px; margin: 0 0 20px;">Hi ${escapeHtml(customerName) || 'daar'},</p>
                        
                        <p style="color: #fff; font-size: 18px; margin: 0 0 24px;">
                            <strong>Reservering staat genoteerd!</strong> ✨
                        </p>
                        
                        <div style="background: #1a1a1a; border-left: 3px solid #3D9970; padding: 16px 20px; margin: 0 0 24px; border-radius: 0 8px 8px 0;">
                            <p style="color: #ccc; margin: 0; font-size: 14px;">
                                📅 ${escapeHtml(bookingDate)} • 🕐 ${escapeHtml(bookingTime)} • 👥 ${guestCount} ${guestCount === 1 ? 'persoon' : 'personen'}
                            </p>
                        </div>
                        
                        ${remarks ? `
                        <p style="color: #888; font-size: 14px; margin: 0 0 16px;">
                            <strong style="color: #ccc;">Opmerking:</strong> ${escapeHtml(remarks)}
                        </p>
                        ` : ''}
                        
                        <p style="color: #888; font-size: 14px; margin: 0 0 24px; line-height: 1.5;">
                            Allergieën of iets wijzigen?<br>
                            Antwoord op deze mail of app/bel: <strong style="color: #fff;">${PHONE_NUMBER}</strong>
                        </p>
                        
                        <p style="color: #888; font-size: 14px; margin: 0;">
                            Tot snel!<br>
                            <strong style="color: #3D9970;">De Tafelaar</strong>
                        </p>
                    </div>
                `,
            });
            console.log(`📧 Restaurant booking confirmation sent to ${customerEmail}`);
        }

        // Admin notification
        await resend.emails.send({
            from: FROM_EMAIL,
            to: ADMIN_EMAIL,
            subject: `🍽️ ${escapeHtml(customerName) || 'Gast'} - ${guestCount}p - ${escapeHtml(bookingTime)}`,
            html: `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; max-width: 500px;">
                    <h2 style="margin: 0 0 16px; font-size: 18px; color: #333;">NIEUWE RESERVERING</h2>
                    
                    <p style="margin: 4px 0; color: #333;"><strong>Naam:</strong> ${escapeHtml(customerName) || 'Niet opgegeven'}</p>
                    <p style="margin: 4px 0; color: #333;">📧 ${escapeHtml(customerEmail) || '-'}</p>
                    <p style="margin: 4px 0; color: #333;">📞 ${escapeHtml(customerPhone) || '-'}</p>
                    
                    <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
                    
                    <p style="margin: 4px 0; color: #333;">📅 ${escapeHtml(bookingDate)} • 🕐 ${escapeHtml(bookingTime)} • 👥 ${guestCount}</p>
                    
                    <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
                    
                    <p style="margin: 4px 0; color: #666;"><strong>Opmerking:</strong> ${escapeHtml(remarks) || 'Geen'}</p>
                </div>
            `,
        });
        console.log(`📧 Restaurant admin notification sent to ${ADMIN_EMAIL}`);

        return { success: true };
    } catch (error) {
        console.error('📧 Restaurant booking email failed:', error.message);
        return { success: false, reason: error.message };
    }
}

// ============================================
// CHEF'S CHOICE NOTIFICATION (7-12 guests)
// ============================================
export async function sendChefsChoiceNotification({
    customerName,
    customerEmail,
    customerPhone,
    remarks,
    tableName,
    bookingDate,
    bookingTime,
    guestCount,
}) {
    if (!resend) {
        console.log('📧 Resend not configured - skipping emails');
        return { success: false, reason: 'Resend not configured' };
    }

    try {
        // Customer gets special chef's choice email
        if (customerEmail) {
            await resend.emails.send({
                from: FROM_EMAIL,
                to: customerEmail,
                replyTo: REPLY_TO_EMAIL,
                subject: `Chef's Choice bevestigd 👨‍🍳`,
                html: `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; background: #0f0f0f; color: #fff; padding: 32px; border-radius: 16px;">
                        <p style="color: #fff; font-size: 16px; margin: 0 0 20px;">Hi ${escapeHtml(customerName) || 'daar'},</p>
                        
                        <p style="color: #fff; font-size: 18px; margin: 0 0 24px;">
                            <strong>Top! Chef's Choice staat genoteerd.</strong> 👨‍🍳✨
                        </p>
                        
                        <div style="background: #1a1a1a; border-left: 3px solid #c9a227; padding: 16px 20px; margin: 0 0 24px; border-radius: 0 8px 8px 0;">
                            <p style="color: #ccc; margin: 0; font-size: 14px;">
                                📅 ${escapeHtml(bookingDate)} • 🕐 ${escapeHtml(bookingTime)} • 👥 ${guestCount} personen
                            </p>
                        </div>
                        
                        <p style="color: #888; font-size: 14px; margin: 0 0 24px; line-height: 1.5;">
                            Heb je allergieën of wensen?<br>
                            Antwoord op deze mail of app/bel: <strong style="color: #fff;">${PHONE_NUMBER}</strong>
                        </p>
                        
                        <p style="color: #888; font-size: 14px; margin: 0;">
                            Tot snel!<br>
                            <strong style="color: #c9a227;">De Tafelaar</strong>
                        </p>
                    </div>
                `,
            });
            console.log(`📧 Chef's Choice confirmation sent to ${customerEmail}`);
        }

        // Admin notification with CHEF'S CHOICE flag
        await resend.emails.send({
            from: FROM_EMAIL,
            to: ADMIN_EMAIL,
            subject: `👨‍🍳 ${escapeHtml(customerName) || 'Gast'} - ${guestCount}p - ${escapeHtml(bookingTime)}`,
            html: `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; max-width: 500px;">
                    <h2 style="margin: 0 0 16px; font-size: 18px; color: #333;">👨‍🍳 CHEF'S CHOICE</h2>
                    
                    <p style="margin: 4px 0; color: #333;"><strong>Naam:</strong> ${escapeHtml(customerName) || 'Niet opgegeven'}</p>
                    <p style="margin: 4px 0; color: #333;">📧 ${escapeHtml(customerEmail) || '-'}</p>
                    <p style="margin: 4px 0; color: #333;">📞 ${escapeHtml(customerPhone) || '-'}</p>
                    
                    <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
                    
                    <p style="margin: 4px 0; color: #333;">📅 ${escapeHtml(bookingDate)} • 🕐 ${escapeHtml(bookingTime)} • 👥 <span style="background: #c9a227; color: #000; padding: 2px 8px; border-radius: 4px; font-weight: bold;">${guestCount}</span></p>
                    
                    <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
                    
                    <p style="margin: 4px 0; color: #666;"><strong>Opmerking:</strong> ${escapeHtml(remarks) || 'Geen'}</p>
                </div>
            `,
        });
        console.log(`📧 Chef's Choice admin notification sent to ${ADMIN_EMAIL}`);

        return { success: true };
    } catch (error) {
        console.error('📧 Chef\'s Choice email failed:', error.message);
        return { success: false, reason: error.message };
    }
}
