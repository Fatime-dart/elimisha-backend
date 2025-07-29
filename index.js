const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const moment = require('moment');

dotenv.config();
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
} = process.env;

// Get access token
async function getAccessToken() {
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const response = await axios.get(
    'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    }
  );
  return response.data.access_token;
}

// STK Push route
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

    console.log('📤 Sending payload to Safaricom:', JSON.stringify(payload, null, 2));

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    console.log('📥 STK Push API response:', response.data);

    res.status(200).json({
      message: 'STK Push Initiated',
      ...response.data,
    });

  } catch (error) {
    console.error('❌ STK Push Error:', error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || 'Internal Server Error' });
  }
});


// ✅ Callback route - receives the final result from Safaricom
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

    // ✅ Log or save successful payment
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

app.listen(port, '0.0.0.0', () => {
  console.log(`✅ M-Pesa STK server running on http://0.0.0.0:${port}`);
});
