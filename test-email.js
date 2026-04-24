require('dotenv').config();
const nodemailer = require('nodemailer');

async function testEmail() {
    console.log('=== Email Test ===\n');
    console.log('Email:', process.env.EMAIL_ADDRESS);
    console.log('SMTP:', process.env.EMAIL_SMTP);
    console.log('Password exists:', !!process.env.EMAIL_PASSWORD);
    console.log('');

    const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_SMTP || 'smtp.zoho.in',
        port: 587,
        secure: false,
        auth: {
            user: process.env.EMAIL_ADDRESS,
            pass: process.env.EMAIL_PASSWORD
        }
    });

    try {
        // Verify connection
        console.log('Verifying connection...');
        await transporter.verify();
        console.log('✅ Connection verified!\n');

        // Send test email
        console.log('Sending test email...');
        const info = await transporter.sendMail({
            from: `"${process.env.SENDER_NAME || 'PARWA Team'}" <${process.env.EMAIL_ADDRESS}>`,
            to: process.env.EMAIL_ADDRESS, // Send to yourself for testing
            subject: '🧪 AI Email Agent Test - It Works!',
            text: 'This is a test email from your AI Email Agent.\n\nIf you received this, your email setup is working correctly!\n\n- PARWA Team'
        });

        console.log('✅ Email sent!');
        console.log('Message ID:', info.messageId);
    } catch (error) {
        console.log('❌ Error:', error.message);
    }
}

testEmail();
