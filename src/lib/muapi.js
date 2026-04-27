import { getModelById, getVideoModelById, getI2IModelById, getI2VModelById, getV2VModelById, getLipSyncModelById } from './models.js';

const FAL_BASE = 'https://queue.fal.run';
const FAL_CDN = 'https://fal.ai';

export class MuapiClient {
    constructor() {}

    getKey() {
        const key = window.__MUAPI_KEY__ || localStorage.getItem('fal_key') || localStorage.getItem('muapi_key');
        if (!key) throw new Error('API Key missing. Please set it in Settings.');
        return key;
    }

    _headers(key) {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Key ${key}`
        };
    }

    async _submitAndPoll(falEndpoint, payload, key, onRequestId, maxAttempts = 60) {
        const submitUrl = `${FAL_BASE}/${falEndpoint}`;

        console.log('[FAL] Requesting:', submitUrl);
        console.log('[FAL] Payload:', payload);

        const response = await fetch(submitUrl, {
            method: 'POST',
            headers: this._headers(key),
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('[FAL] API Error Body:', errText);
            throw new Error(`API Request Failed: ${response.status} ${response.statusText} - ${errText.slice(0, 100)}`);
        }

        const submitData = await response.json();
        console.log('[FAL] Submit Response:', submitData);

        const requestId = submitData.request_id;
        if (!requestId) return submitData;

        if (onRequestId) onRequestId(requestId);

        return await this._pollForResult(falEndpoint, requestId, key, maxAttempts);
    }

    async _pollForResult(falEndpoint, requestId, key, maxAttempts = 60, interval = 2000) {
        const statusUrl = `${FAL_BASE}/${falEndpoint}/requests/${requestId}/status`;
        const resultUrl = `${FAL_BASE}/${falEndpoint}/requests/${requestId}`;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            await new Promise(resolve => setTimeout(resolve, interval));
            console.log(`[FAL] Polling attempt ${attempt}/${maxAttempts}...`);

            try {
                const statusResponse = await fetch(statusUrl, {
                    headers: this._headers(key)
                });

                if (!statusResponse.ok) {
                    if (statusResponse.status >= 500) continue;
                    const errText = await statusResponse.text();
                    throw new Error(`Poll Failed: ${statusResponse.status} - ${errText.slice(0, 100)}`);
                }

                const statusData = await statusResponse.json();
                console.log('[FAL] Status:', statusData.status);

                const status = statusData.status;

                if (status === 'COMPLETED') {
                    const resultResponse = await fetch(resultUrl, {
                        headers: this._headers(key)
                    });
                    if (!resultResponse.ok) {
                        const errText = await resultResponse.text();
                        throw new Error(`Result fetch failed: ${resultResponse.status} - ${errText.slice(0, 100)}`);
                    }
                    const result = await resultResponse.json();
                    console.log('[FAL] Result:', result);
                    return result;
                }

                if (status === 'FAILED' || status === 'ERROR') {
                    throw new Error(`Generation failed: ${statusData.error || 'Unknown error'}`);
                }

            } catch (error) {
                if (attempt === maxAttempts) throw error;
                console.warn('[FAL] Poll attempt failed, retrying...', error.message);
            }
        }

        throw new Error('Generation timed out after polling.');
    }

    _extractImageUrl(result) {
        return result?.images?.[0]?.url || result?.image?.url || result?.outputs?.[0] || result?.url;
    }

    _extractVideoUrl(result) {
        return result?.video?.url || result?.videos?.[0]?.url || result?.outputs?.[0] || result?.url;
    }

    async generateImage(params) {
        const key = this.getKey();
        const modelInfo = getModelById(params.model);
        const endpoint = modelInfo?.endpoint || params.model;
        const falEndpoint = `fal-ai/${endpoint}`;

        const payload = { prompt: params.prompt };
        if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
        if (params.resolution) payload.resolution = params.resolution;
        if (params.quality) payload.quality = params.quality;
        if (params.image_url) {
            payload.image_url = params.image_url;
            payload.strength = params.strength || 0.6;
        } else {
            payload.image_url = null;
        }
        if (params.seed && params.seed !== -1) payload.seed = params.seed;

        try {
            const result = await this._submitAndPoll(falEndpoint, payload, key, params.onRequestId, 60);
            const imageUrl = this._extractImageUrl(result);
            console.log('[FAL] Image URL:', imageUrl);
            return { ...result, url: imageUrl };
        } catch (error) {
            console.error('FAL Client Error:', error);
            throw error;
        }
    }

    async generateVideo(params) {
        const key = this.getKey();
        const modelInfo = getVideoModelById(params.model);
        const endpoint = modelInfo?.endpoint || params.model;
        const falEndpoint = `fal-ai/${endpoint}`;

        const payload = {};
        if (params.prompt) payload.prompt = params.prompt;
        if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
        if (params.duration) payload.duration = params.duration;
        if (params.resolution) payload.resolution = params.resolution;
        if (params.quality) payload.quality = params.quality;
        if (params.mode) payload.mode = params.mode;
        if (params.image_url) payload.image_url = params.image_url;

        try {
            const result = await this._submitAndPoll(falEndpoint, payload, key, params.onRequestId, 900);
            const videoUrl = this._extractVideoUrl(result);
            console.log('[FAL] Video URL:', videoUrl);
            return { ...result, url: videoUrl };
        } catch (error) {
            console.error('FAL Video Client Error:', error);
            throw error;
        }
    }

    async generateI2I(params) {
        const key = this.getKey();
        const modelInfo = getI2IModelById(params.model);
        const endpoint = modelInfo?.endpoint || params.model;
        const falEndpoint = `fal-ai/${endpoint}`;

        const payload = {};
        if (params.prompt) payload.prompt = params.prompt || '';

        const imageField = modelInfo?.imageField || 'image_url';
        const imagesList = params.images_list?.length > 0 ? params.images_list : (params.image_url ? [params.image_url] : null);
        if (imagesList) {
            if (imageField === 'images_list') {
                payload.images_list = imagesList;
            } else {
                payload[imageField] = imagesList[0];
            }
        }

        if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
        if (params.resolution) payload.resolution = params.resolution;
        if (params.quality) payload.quality = params.quality;

        try {
            const result = await this._submitAndPoll(falEndpoint, payload, key, params.onRequestId, 60);
            const imageUrl = this._extractImageUrl(result);
            console.log('[FAL] I2I Result URL:', imageUrl);
            return { ...result, url: imageUrl };
        } catch (error) {
            console.error('FAL I2I Error:', error);
            throw error;
        }
    }

    async generateI2V(params) {
        const key = this.getKey();
        const modelInfo = getI2VModelById(params.model);
        const endpoint = modelInfo?.endpoint || params.model;
        const falEndpoint = `fal-ai/${endpoint}`;

        const payload = {};
        if (params.prompt) payload.prompt = params.prompt;

        const imageField = modelInfo?.imageField || 'image_url';
        if (params.image_url) {
            if (imageField === 'images_list') {
                payload.images_list = [params.image_url];
            } else {
                payload[imageField] = params.image_url;
            }
        }

        if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
        if (params.duration) payload.duration = params.duration;
        if (params.resolution) payload.resolution = params.resolution;
        if (params.quality) payload.quality = params.quality;
        if (params.mode) payload.mode = params.mode;
        if (params.name) payload.name = params.name;

        try {
            const result = await this._submitAndPoll(falEndpoint, payload, key, params.onRequestId, 900);
            const videoUrl = this._extractVideoUrl(result);
            console.log('[FAL] I2V Result URL:', videoUrl);
            return { ...result, url: videoUrl };
        } catch (error) {
            console.error('FAL I2V Error:', error);
            throw error;
        }
    }

    async uploadFile(file) {
        const key = this.getKey();
        const url = `${FAL_CDN}/v1/serverless/files/file/upload`;

        const formData = new FormData();
        formData.append('file_upload', file);

        console.log('[FAL] Uploading file:', file.name);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Key ${key}` },
            body: formData
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`File upload failed: ${response.status} - ${errText.slice(0, 100)}`);
        }

        const data = await response.json();
        console.log('[FAL] Upload response:', data);

        const fileUrl = data.url || data.access_url || data.file_url;
        if (!fileUrl) throw new Error('No URL returned from file upload');
        return fileUrl;
    }

    async processV2V(params) {
        const key = this.getKey();
        const modelInfo = getV2VModelById(params.model);
        const endpoint = modelInfo?.endpoint || params.model;
        const falEndpoint = `fal-ai/${endpoint}`;

        const videoField = modelInfo?.videoField || 'video_url';
        const payload = { [videoField]: params.video_url };

        try {
            const result = await this._submitAndPoll(falEndpoint, payload, key, params.onRequestId, 900);
            const videoUrl = this._extractVideoUrl(result);
            console.log('[FAL] V2V Result URL:', videoUrl);
            return { ...result, url: videoUrl };
        } catch (error) {
            console.error('FAL V2V Error:', error);
            throw error;
        }
    }

    async processLipSync(params) {
        const key = this.getKey();
        const modelInfo = getLipSyncModelById(params.model);
        const endpoint = modelInfo?.endpoint || params.model;
        const falEndpoint = `fal-ai/${endpoint}`;

        const payload = {};
        if (params.audio_url) payload.audio_url = params.audio_url;
        if (params.image_url) payload.image_url = params.image_url;
        if (params.video_url) payload.video_url = params.video_url;
        if (params.prompt) payload.prompt = params.prompt;
        if (params.resolution) payload.resolution = params.resolution;
        if (params.seed !== undefined && params.seed !== -1) payload.seed = params.seed;

        try {
            const result = await this._submitAndPoll(falEndpoint, payload, key, params.onRequestId, 900);
            const videoUrl = this._extractVideoUrl(result);
            console.log('[FAL] LipSync Result URL:', videoUrl);
            return { ...result, url: videoUrl };
        } catch (error) {
            console.error('FAL LipSync Error:', error);
            throw error;
        }
    }

    getDimensionsFromAR(ar) {
        switch (ar) {
            case '1:1': return [1024, 1024];
            case '16:9': return [1280, 720];
            case '9:16': return [720, 1280];
            case '4:3': return [1152, 864];
            case '3:2': return [1216, 832];
            case '21:9': return [1536, 640];
            default: return [1024, 1024];
        }
    }
}

export const muapi = new MuapiClient();
