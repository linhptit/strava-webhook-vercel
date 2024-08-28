const express = require('express');
const app = express();
// const quotes = require('motivational-quotes');
const quotes = require('./quotes.json')


// write function to get quotes from json file
const getQuote = () => {
   return quotes[Math.floor(Math.random() * quotes.length)].quote;
}

// inject .env
require('dotenv').config();

const PORT = process.env.PORT || 3000;

// Your predefined verify token
const STRAVA_VERIFY_TOKEN = process.env.STRAVA_VERIFY_TOKEN;

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const STRAVA_REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN;

app.use(express.json());

// write function to get new access token from refresh token
const getNewAccessToken = async () => {
    const body = JSON.stringify({
            client_id: STRAVA_CLIENT_ID,
            client_secret: STRAVA_CLIENT_SECRET,
            refresh_token: STRAVA_REFRESH_TOKEN,
            grant_type: 'refresh_token',
        });
    console.log('Body:', body);
    const response = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            client_id: STRAVA_CLIENT_ID,
            client_secret: STRAVA_CLIENT_SECRET,
            refresh_token: STRAVA_REFRESH_TOKEN,
            grant_type: 'refresh_token',
        }),
    });
    const data = await response.json();
    return data.access_token;
};

app.get('/webhook', async (req, res) => {
    const { 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;

    if (token === STRAVA_VERIFY_TOKEN) {
        return res.status(200).send({ 'hub.challenge': challenge });
    } else {
        return res.status(403).send('Forbidden');
    }
});

// Endpoint to handle Strava webhook verification
app.post('/webhook', async (req, res) => {
    console.log('Received a webhook event:', req.body);
    const { hub } = req.query;

    // URL Validation
    console.log('Received hub challenge:', hub);

    const { object_type, aspect_type, object_id } = req.body;

    if (object_type !== 'activity') {
        console.log('Invalid object type:', object_type);
        return res.status(200).send('Invalid object type');
    }

    if (aspect_type === 'create') {
        const title = getQuote();
        console.log('Quote:', title);

        const accessToken = await getNewAccessToken();
        console.log('Access token:', accessToken);
        // update strava activity with quote
        // PUT www.strava.com/api/v3/activities/{strava_activity_id}
        const response = await fetch(`https://www.strava.com/api/v3/activities/${object_id}`, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                title,
                name: title
            }),
        });

        const data = await response.json();
        console.log('Updated activity:' , data.body);

        console.log('Invalid hub challenge:', hub);

        // Handle incoming webhook event
        const event = req.body;
        console.log('Received event:', event);

        // Respond to Strava
        return res.status(200).send('EVENT_RECEIVED');
    } else if (aspect_type === 'update') {
        console.log('Activity updated:', object_id);
        // todo get detail of activity
        const accessToken = await getNewAccessToken();
        console.log('Access token:', accessToken);
        const activity = await fetch(`https://www.strava.com/api/v3/activities/${object_id}`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        const data = await activity.json();
        const description = data.description;

        if (description.includes("Powered by https://strautomator.com")) {
            console.log('Activity contains quote:', description);
            // remove description
            const newDesc = description.replace("Powered by https://strautomator.com", "");
            // update activity
            const response = await fetch(`https://www.strava.com/api/v3/activities/${object_id}`, {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    description: newDesc.trim(),
                }),
            });
            const data = await response.json();
            console.log('Updated activity:' , data.body);
            return res.status(200).send('EVENT_RECEIVED');
        }

        return res.status(200).send('EVENT_RECEIVED');
    }

    return res.status(200).send('EVENT_RECEIVED');
});

app.listen(PORT, () => console.log(`Webhook listening on port ${PORT}`));
