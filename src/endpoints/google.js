import { Buffer } from 'node:buffer';
import fetch from 'node-fetch';
import express from 'express';
import { speak, languages } from 'google-translate-api-x';

import { readSecret, SECRET_KEYS } from './secrets.js';
import { GEMINI_SAFETY } from '../constants.js';

const API_MAKERSUITE = 'https://generativelanguage.googleapis.com';
const API_VERTEX_AI = 'https://us-central1-aiplatform.googleapis.com';

export const router = express.Router();

router.post('/caption-image', async (request, response) => {
    try {
        const mimeType = request.body.image.split(';')[0].split(':')[1];
        const base64Data = request.body.image.split(',')[1];
        const useVertexAi = request.body.api === 'vertexai';
        const apiName = useVertexAi ? 'Google Vertex AI' : 'Google AI Studio';
        let apiKey;
        let apiUrl;
        if (useVertexAi) {
            apiKey = request.body.reverse_proxy ? request.body.proxy_password : readSecret(request.user.directories, SECRET_KEYS.VERTEXAI);
            apiUrl = new URL(request.body.reverse_proxy || API_VERTEX_AI);
        } else {
            apiKey = request.body.reverse_proxy ? request.body.proxy_password : readSecret(request.user.directories, SECRET_KEYS.MAKERSUITE);
            apiUrl = new URL(request.body.reverse_proxy || API_MAKERSUITE);
        }
        const model = request.body.model || 'gemini-2.0-flash';
        let url;
        if (useVertexAi) {
            url = `${apiUrl.origin}/v1/publishers/google/models/${model}:generateContent?key=${apiKey}`;
        } else {
            url = `${apiUrl.origin}/v1beta/models/${model}:generateContent?key=${apiKey}`;
        }
        const body = {
            contents: [{
                role: 'user',
                parts: [
                    { text: request.body.prompt },
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Data,
                        },
                    }],
            }],
            safetySettings: GEMINI_SAFETY,
        };

        console.debug(`${apiName} captioning request`, model, body);

        const result = await fetch(url, {
            body: JSON.stringify(body),
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!result.ok) {
            const error = await result.json();
            console.error(`${apiName} API returned error: ${result.status} ${result.statusText}`, error);
            return response.status(500).send({ error: true });
        }

        /** @type {any} */
        const data = await result.json();
        console.info(`${apiName} captioning response`, data);

        const candidates = data?.candidates;
        if (!candidates) {
            return response.status(500).send('No candidates found, image was most likely filtered.');
        }

        const caption = candidates[0].content.parts[0].text;
        if (!caption) {
            return response.status(500).send('No caption found');
        }

        return response.json({ caption });
    } catch (error) {
        console.error(error);
        response.status(500).send('Internal server error');
    }
});

router.post('/list-voices', (_, response) => {
    return response.json(languages);
});

router.post('/generate-voice', async (request, response) => {
    try {
        const text = request.body.text;
        const voice = request.body.voice ?? 'en';

        const result = await speak(text, { to: voice, forceBatch: false });
        const buffer = Array.isArray(result)
            ? Buffer.concat(result.map(x => new Uint8Array(Buffer.from(x.toString(), 'base64'))))
            : Buffer.from(result.toString(), 'base64');

        response.setHeader('Content-Type', 'audio/mpeg');
        return response.send(buffer);
    } catch (error) {
        console.error('Google Translate TTS generation failed', error);
        response.status(500).send('Internal server error');
    }
});
