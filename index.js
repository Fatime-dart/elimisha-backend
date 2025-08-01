const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const moment = require('moment');
const twilio = require('twilio'); // Moved up here

dotenv.config();
console.log('✅ Loaded ENV Variables:', {
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_SERVICE_SID: process.env.TWILIO_SERVICE_SID,
});
const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;

const {
  CONSUMER_KEY,
  CONSUMER_SECRET,
  BUSINESS_SHORT_CODE,
  PASSKEY,
  SANDBOX_PHONE,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_SERVICE_SID,
} = process.env;

// 🔐 Twilio client
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// 🔐 Send OTP route
app.post('/send-otp', async (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }
  console.log('📌 Service SID:', TWILIO_SERVICE_SID);

  try {
    const verification = await twilioClient.verify
      .services(TWILIO_SERVICE_SID)
      .verifications.create({
        to: phone,
        channel: 'sms',
      });

    res.status(200).json({
      message: 'OTP sent successfully',
      sid: verification.sid,
    });
  } catch (error) {
    console.error('❌ Error sending OTP:', error.response?.data || error.message || error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// 🔐 Verify OTP route
app.post('/verify-otp', async (req, res) => {
  const { phone, code } = req.body;

  if (!phone || !code) {
    return res.status(400).json({ error: 'Phone number and OTP code are required' });
  }

  try {
    const verificationCheck = await twilioClient.verify
      .services(TWILIO_SERVICE_SID)
      .verificationChecks.create({
        to: phone,
        code,
      });

    if (verificationCheck.status === 'approved') {
      res.status(200).json({ message: 'OTP verified successfully' });
    } else {
      res.status(401).json({ error: 'Invalid OTP' });
    }
  } catch (error) {
    console.error('❌ OTP Verification Error:', error.message);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

// 💰 Get M-Pesa access token
async function getAccessToken() {
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const response = await axios.get(
    'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    {
      headers: { Authorization: `Basic ${auth}` },
    }
  );
  return response.data.access_token;
}

// 💰 STK Push route
app.post('/stk-push', async (req, res) => {
  try {
    console.log('📞 STK Push request received');

    const token = await getAccessToken();
    console.log('🔑 Access token retrieved:', token);

    const timestamp = moment().format('YYYYMMDDHHmmss');
    const password = Buffer.from(`${BUSINESS_SHORT_CODE}${PASSKEY}${timestamp}`).toString('base64');

    const payload = {
      BusinessShortCode: BUSINESS_SHORT_CODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: req.body.amount || 1,
      PartyA: req.body.phone || SANDBOX_PHONE,
      PartyB: BUSINESS_SHORT_CODE,
      PhoneNumber: req.body.phone || SANDBOX_PHONE,
      CallBackURL: 'https://elimisha-backend-kce7.onrender.com/callback',
      AccountReference: 'ElimishaApp',
      TransactionDesc: 'Loan Payment',
    };

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      payload,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    res.status(200).json({
      message: 'STK Push Initiated',
      ...response.data,
    });

  } catch (error) {
    console.error('❌ STK Push Error:', error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || 'Internal Server Error' });
  }
});

// 💰 Callback route
app.post('/callback', async (req, res) => {
  const callbackData = req.body;

  console.log('📩 M-Pesa Callback Received:', JSON.stringify(callbackData, null, 2));

  const stkCallback = callbackData.Body?.stkCallback;
  if (!stkCallback) {
    return res.status(400).json({ error: 'Invalid callback data' });
  }

  const resultCode = stkCallback.ResultCode;
  const resultDesc = stkCallback.ResultDesc;
  const checkoutRequestID = stkCallback.CheckoutRequestID;

  if (resultCode === 0) {
    const metadata = stkCallback.CallbackMetadata?.Item || [];
    const mpesaReceiptNumber = metadata.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
    const amount = metadata.find(i => i.Name === 'Amount')?.Value;
    const phone = metadata.find(i => i.Name === 'PhoneNumber')?.Value;

    console.log(`✅ Payment Success:
    Phone: ${phone}
    Amount: ${amount}
    Receipt: ${mpesaReceiptNumber}
    CheckoutRequestID: ${checkoutRequestID}`);
  } else {
    console.log(`❌ Payment Failed [${resultCode}]: ${resultDesc}`);
  }

  res.status(200).json({ message: 'Callback received successfully' });
});

// ✅ Start the server
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
