const express = require('express');
const app = express();
// const quotes = require('motivational-quotes');
const quotes = require('./quotes.json')
const { Redis } = require('@upstash/redis');

// inject .env
require('dotenv').config();

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// write function to get quotes from json file
const getQuote = () => {
   return quotes[Math.floor(Math.random() * quotes.length)].quote;
}

const PORT = process.env.PORT || 3000;

// Your predefined verify token
const STRAVA_VERIFY_TOKEN = process.env.STRAVA_VERIFY_TOKEN;

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

app.use(express.json());

/**
 * Function to get refresh token from Redis
 * @param {string} athleteId - The ID of the athlete whose refresh token is to be retrieved.
 * @returns {Promise<string | null>} - Returns the refresh token if found, otherwise null.
 */
const getRefreshToken = async (athleteId) => {
    try {
        const refreshToken = await redis.get(`athlete:${athleteId}:refresh_token`);

        if (!refreshToken) {
            console.log(`No refresh token found for athlete ID: ${athleteId}`);
            return null;
        }

        console.log(`Retrieved refresh token for athlete ID: ${athleteId}`);
        return refreshToken;
    } catch (error) {
        console.error('Error retrieving refresh token from Redis:', error);
        throw new Error('Could not retrieve refresh token');
    }
};

// write function to get new access token from refresh token
const getNewAccessToken = async (stravaRefreshToken) => {
    const body = JSON.stringify({
            client_id: STRAVA_CLIENT_ID,
            client_secret: STRAVA_CLIENT_SECRET,
            refresh_token: stravaRefreshToken,
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
            refresh_token: stravaRefreshToken,
            grant_type: 'refresh_token',
        }),
    });
    const data = await response.json();
    return data.access_token;
};

// Strava OAuth Callback URL
app.get('/strava/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).send('Missing authorization code');
    }

    try {
        // Exchange the authorization code for an access token
        const response = await fetch('https://www.strava.com/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                client_id: STRAVA_CLIENT_ID,
                client_secret: STRAVA_CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code',
            }),
        });

        const data = await response.json();

        if (data.access_token) {
            // Store the access token, refresh token, and other relevant data
            console.log('Access Token:', data.access_token);
            console.log('Refresh Token:', data.refresh_token);
            console.log('Athlete Data:', data.athlete);

            // Store the athlete ID and refresh token in Upstash Redis
            const athleteId = data.athlete.id;
            const refreshToken = data.refresh_token;

            // Use the athlete ID as the key and store the refresh token as the value
            await redis.set(`athlete:${athleteId}:refresh_token`, refreshToken);

            console.log('Stored in Redis:', {
                athleteId,
                refreshToken,
            });

            // Respond with success message
            return res.status(200).json({
                message: 'Tokens successfully stored in Redis',
                access_token: data.access_token,
                athlete: data.athlete,
            });
        } else {
            // Handle error scenario
            console.log('Error in token exchange:', data);
            return res.status(500).json({ error: 'Failed to exchange authorization code for access token' });
        }
    } catch (error) {
        console.error('Error in Strava callback:', error);
        return res.status(500).send('Internal Server Error');
    }
});


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

    const { object_type, aspect_type, object_id, owner_id } = req.body;

    // check strava owner id is null or not
    if (owner_id === null || owner_id === undefined) {
        console.log('Owner ID is null:', owner_id);
        return res.status(200).send('Owner ID is null');
    }

    if (object_type !== 'activity') {
        console.log('Invalid object type:', object_type);
        return res.status(200).send('Invalid object type');
    }

    // check owner id exists in redis
    const stravaRefreshToken = await getRefreshToken(owner_id);
    if (!stravaRefreshToken) {
        console.log('Refresh token not found for owner ID:', owner_id);
        return res.status(200).send('Refresh token not found');
    }

    if (aspect_type === 'create') {
        const title = getQuote();
        console.log('Quote:', title);

        const accessToken = await getNewAccessToken(stravaRefreshToken);
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
        const accessToken = await getNewAccessToken(stravaRefreshToken);
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
