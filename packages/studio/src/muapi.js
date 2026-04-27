import { getModelById, getVideoModelById, getI2IModelById, getI2VModelById, getV2VModelById, getLipSyncModelById } from './models.js';

const FAL_BASE = 'https://queue.fal.run';
const FAL_CDN = 'https://fal.ai';

function authHeaders(key) {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Key ${key}`
    };
}

function extractImageUrl(result) {
    return result?.images?.[0]?.url || result?.image?.url || result?.outputs?.[0] || result?.url;
}

function extractVideoUrl(result) {
    return result?.video?.url || result?.videos?.[0]?.url || result?.outputs?.[0] || result?.url;
}

async function pollForResult(falEndpoint, requestId, key, maxAttempts = 900, interval = 2000) {
    const statusUrl = `${FAL_BASE}/${falEndpoint}/requests/${requestId}/status`;
    const resultUrl = `${FAL_BASE}/${falEndpoint}/requests/${requestId}`;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, interval));
        try {
            const statusResponse = await fetch(statusUrl, {
                headers: authHeaders(key)
            });
            if (!statusResponse.ok) {
                if (statusResponse.status >= 500) continue;
                const errText = await statusResponse.text();
                throw new Error(`Poll Failed: ${statusResponse.status} - ${errText.slice(0, 100)}`);
            }
            const statusData = await statusResponse.json();
            const status = statusData.status;

            if (status === 'COMPLETED') {
                const resultResponse = await fetch(resultUrl, { headers: authHeaders(key) });
                if (!resultResponse.ok) {
                    const errText = await resultResponse.text();
                    throw new Error(`Result fetch failed: ${resultResponse.status} - ${errText.slice(0, 100)}`);
                }
                return await resultResponse.json();
            }
            if (status === 'FAILED' || status === 'ERROR') {
                throw new Error(`Generation failed: ${statusData.error || 'Unknown error'}`);
            }
        } catch (error) {
            if (attempt === maxAttempts) throw error;
        }
    }
    throw new Error('Generation timed out after polling.');
}

async function submitAndPoll(falEndpoint, payload, key, onRequestId, maxAttempts = 60) {
    const url = `${FAL_BASE}/${falEndpoint}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: authHeaders(key),
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API Request Failed: ${response.status} ${response.statusText} - ${errText.slice(0, 100)}`);
    }
    const submitData = await response.json();
    const requestId = submitData.request_id;
    if (!requestId) return submitData;
    if (onRequestId) onRequestId(requestId);
    return await pollForResult(falEndpoint, requestId, key, maxAttempts);
}

export async function generateImage(apiKey, params) {
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
    } else if (params.images_list) {
        payload.images_list = params.images_list;
    } else {
        payload.image_url = null;
    }
    if (params.seed && params.seed !== -1) payload.seed = params.seed;
    const result = await submitAndPoll(falEndpoint, payload, apiKey, params.onRequestId, 60);
    return { ...result, url: extractImageUrl(result) };
}

export async function generateI2I(apiKey, params) {
    const modelInfo = getI2IModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const falEndpoint = `fal-ai/${endpoint}`;
    const payload = {};
    if (params.prompt) payload.prompt = params.prompt;
    const imageField = modelInfo?.imageField || 'image_url';
    const imagesList = params.images_list?.length > 0 ? params.images_list : (params.image_url ? [params.image_url] : null);
    if (imagesList) {
        if (imageField === 'images_list') payload.images_list = imagesList;
        else payload[imageField] = imagesList[0];
    }
    if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
    if (params.resolution) payload.resolution = params.resolution;
    if (params.quality) payload.quality = params.quality;
    const result = await submitAndPoll(falEndpoint, payload, apiKey, params.onRequestId, 60);
    return { ...result, url: extractImageUrl(result) };
}

export async function generateVideo(apiKey, params) {
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
    const result = await submitAndPoll(falEndpoint, payload, apiKey, params.onRequestId, 900);
    return { ...result, url: extractVideoUrl(result) };
}

export async function generateI2V(apiKey, params) {
    const modelInfo = getI2VModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const falEndpoint = `fal-ai/${endpoint}`;
    const payload = {};
    if (params.prompt) payload.prompt = params.prompt;
    const imageField = modelInfo?.imageField || 'image_url';
    if (params.image_url) {
        if (imageField === 'images_list') payload.images_list = [params.image_url];
        else payload[imageField] = params.image_url;
    }
    if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
    if (params.duration) payload.duration = params.duration;
    if (params.resolution) payload.resolution = params.resolution;
    if (params.quality) payload.quality = params.quality;
    if (params.mode) payload.mode = params.mode;
    const result = await submitAndPoll(falEndpoint, payload, apiKey, params.onRequestId, 900);
    return { ...result, url: extractVideoUrl(result) };
}

export async function generateMarketingStudioAd(apiKey, params) {
    const endpoint = params.resolution === '1080p' ? 'sd-2-vip-omni-reference-1080p' : 'seedance-2-vip-omni-reference';
    const falEndpoint = `fal-ai/${endpoint}`;
    const payload = {
        prompt: params.prompt,
        aspect_ratio: params.aspect_ratio || '16:9',
        duration: params.duration || 5,
        images_list: params.images_list || [],
        video_files: params.video_files || []
    };
    const result = await submitAndPoll(falEndpoint, payload, apiKey, params.onRequestId, 900);
    return { ...result, url: extractVideoUrl(result) };
}

export async function processLipSync(apiKey, params) {
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
    const result = await submitAndPoll(falEndpoint, payload, apiKey, params.onRequestId, 900);
    return { ...result, url: extractVideoUrl(result) };
}

export function uploadFile(apiKey, file, onProgress) {
    return new Promise((resolve, reject) => {
        const url = `${FAL_CDN}/v1/serverless/files/file/upload`;
        const formData = new FormData();
        formData.append('file_upload', file);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.setRequestHeader('Authorization', `Key ${apiKey}`);

        if (onProgress) {
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percentComplete = Math.round((event.loaded / event.total) * 100);
                    onProgress(percentComplete);
                }
            };
        }

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    const fileUrl = data.url || data.access_url || data.file_url;
                    if (!fileUrl) {
                        reject(new Error('No URL returned from file upload'));
                    } else {
                        resolve(fileUrl);
                    }
                } catch (e) {
                    reject(new Error('Failed to parse upload response'));
                }
            } else {
                let detail = xhr.statusText;
                try {
                    const errObj = JSON.parse(xhr.responseText);
                    detail = errObj.detail || detail;
                } catch (e) {}
                reject(new Error(`File upload failed: ${xhr.status} - ${detail}`));
            }
        };

        xhr.onerror = () => reject(new Error('Network error during file upload'));
        xhr.send(formData);
    });
}

export async function getUserBalance(apiKey) {
    const response = await fetch(`${FAL_BASE}/api/v1/account/balance`, {
        headers: authHeaders(apiKey)
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch balance: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}

export async function getTemplateWorkflows(apiKey) {
    const response = await fetch(`${FAL_BASE}/workflow/get-template-workflows`, {
        headers: authHeaders(apiKey)
    });
    if (!response.ok) throw new Error(`Failed to fetch template workflows: ${response.status}`);
    return await response.json();
}

export async function getUserWorkflows(apiKey) {
    const response = await fetch(`${FAL_BASE}/workflow/get-workflow-defs`, {
        headers: authHeaders(apiKey)
    });
    if (!response.ok) throw new Error(`Failed to fetch user workflows: ${response.status}`);
    return await response.json();
}

export async function getPublishedWorkflows(apiKey) {
    const response = await fetch(`${FAL_BASE}/workflow/get-published-workflows`, {
        headers: authHeaders(apiKey)
    });
    if (!response.ok) throw new Error(`Failed to fetch published workflows: ${response.status}`);
    return await response.json();
}

export async function getTemplateAgents(apiKey) {
    const response = await fetch(`${FAL_BASE}/agents/templates/agents`, {
        headers: authHeaders(apiKey)
    });
    if (!response.ok) throw new Error(`Failed to fetch template agents: ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : (data.agents || data.items || []);
}

export async function getUserAgents(apiKey) {
    const response = await fetch(`${FAL_BASE}/agents/user/agents`, {
        headers: authHeaders(apiKey)
    });
    if (!response.ok) throw new Error(`Failed to fetch user agents: ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : (data.agents || data.items || []);
}

export async function getPublishedAgents(apiKey) {
    const response = await fetch(`${FAL_BASE}/agents/featured/agents`, {
        headers: authHeaders(apiKey)
    });
    if (!response.ok) throw new Error(`Failed to fetch featured agents: ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : (data.agents || data.items || []);
}

export async function getUserConversations(apiKey) {
    const response = await fetch(`${FAL_BASE}/agents/user/conversations`, {
        headers: authHeaders(apiKey)
    });
    if (!response.ok) throw new Error(`Failed to fetch conversations: ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : [];
}

export async function createWorkflow(apiKey, payload) {
    const response = await fetch(`${FAL_BASE}/workflow/create`, {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Failed to create workflow: ${response.status}`);
    return await response.json();
}

export async function updateWorkflowName(apiKey, workflowId, name) {
    const response = await fetch(`${FAL_BASE}/workflow/update-name/${workflowId}`, {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify({ name })
    });
    if (!response.ok) throw new Error(`Failed to rename workflow: ${response.status}`);
    return await response.json();
}

export async function deleteWorkflow(apiKey, workflowId) {
    const response = await fetch(`${FAL_BASE}/workflow/delete-workflow-def/${workflowId}`, {
        method: 'DELETE',
        headers: authHeaders(apiKey)
    });
    if (!response.ok) throw new Error(`Failed to delete workflow: ${response.status}`);
    return await response.json();
}

export async function getWorkflowInputs(apiKey, workflowId) {
    const response = await fetch(`${FAL_BASE}/workflow/${workflowId}/api-inputs`, {
        headers: authHeaders(apiKey)
    });
    if (!response.ok) throw new Error(`Failed to fetch workflow inputs: ${response.status}`);
    return await response.json();
}

export async function executeWorkflow(apiKey, workflowId, inputs) {
    const response = await fetch(`${FAL_BASE}/workflow/${workflowId}/api-execute`, {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify({ inputs })
    });
    if (!response.ok) throw new Error(`Failed to execute workflow: ${response.status}`);
    const submitData = await response.json();
    const runId = submitData.run_id || submitData.id;
    if (!runId) return submitData;
    return await pollWorkflowResult(runId, apiKey);
}

async function pollWorkflowResult(runId, apiKey, maxAttempts = 900, interval = 2000) {
    const pollUrl = `${FAL_BASE}/workflow/run/${runId}/api-outputs`;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, interval));
        try {
            const response = await fetch(pollUrl, { headers: authHeaders(apiKey) });
            if (!response.ok) {
                if (response.status >= 500) continue;
                throw new Error(`Poll Failed: ${response.status}`);
            }
            const data = await response.json();
            const status = data.status?.toLowerCase();
            if (status === 'completed' || status === 'succeeded' || status === 'success') return data;
            if (status === 'failed' || status === 'error') throw new Error(`Workflow failed: ${data.error || 'Unknown error'}`);
        } catch (error) {
            if (attempt === maxAttempts) throw error;
        }
    }
    throw new Error('Workflow timed out after polling.');
}

export async function getAllNodeSchemas(apiKey, workflowId) {
    const response = await fetch(`${FAL_BASE}/workflow/${workflowId}/node-schemas`, {
        headers: authHeaders(apiKey)
    });
    if (!response.ok) throw new Error(`Failed to fetch node schemas: ${response.status}`);
    return await response.json();
}

export async function getWorkflowData(apiKey, workflowId) {
    const response = await fetch(`${FAL_BASE}/workflow/get-workflow-def/${workflowId}`, {
        headers: authHeaders(apiKey)
    });
    if (!response.ok) throw new Error(`Failed to fetch workflow data: ${response.status}`);
    return await response.json();
}

export async function getNodeSchemas(apiKey, workflowId) {
    const response = await fetch(`${FAL_BASE}/workflow/${workflowId}/api-node-schemas`, {
        headers: authHeaders(apiKey)
    });
    if (!response.ok) throw new Error(`Failed to fetch node schemas: ${response.status}`);
    return await response.json();
}

export async function runSingleNode(apiKey, workflowId, nodeId, payload) {
    const response = await fetch(`${FAL_BASE}/workflow/${workflowId}/node/${nodeId}/run`, {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Failed to run single node: ${response.status}`);
    return await response.json();
}

export async function deleteNodeRun(apiKey, nodeRunId) {
    const response = await fetch(`${FAL_BASE}/workflow/node-run/${nodeRunId}`, {
        method: 'DELETE',
        headers: authHeaders(apiKey)
    });
    if (!response.ok) throw new Error(`Failed to delete node run: ${response.status}`);
    return await response.json();
}

export async function getNodeStatus(apiKey, runId) {
    const response = await fetch(`${FAL_BASE}/workflow/run/${runId}/status`, {
        headers: authHeaders(apiKey)
    });
    if (!response.ok) throw new Error(`Failed to get node status: ${response.status}`);
    return await response.json();
}

export async function handleProxyRequest(prefix, path, method, headers, body, apiKey) {
    const url = `${FAL_BASE}/${prefix}/${path}`;

    const finalHeaders = new Headers(headers);
    finalHeaders.delete('host');
    finalHeaders.delete('connection');
    finalHeaders.delete('content-length');

    if (apiKey) {
        finalHeaders.set('Authorization', `Key ${apiKey}`);
    }
    finalHeaders.delete('x-api-key');

    try {
        const response = await fetch(url, {
            method,
            headers: finalHeaders,
            body: (method !== 'GET' && method !== 'HEAD') ? body : undefined,
            redirect: 'follow',
        });

        const contentType = response.headers.get('Content-Type') || 'application/json';
        const buffer = await response.arrayBuffer();

        return {
            status: response.status,
            contentType,
            data: buffer
        };
    } catch (error) {
        console.error(`FAL Proxy error for ${url}:`, error);
        throw error;
    }
}

export async function handleServerSideProxy(prefix, request, params, apiKey) {
    try {
        const slug = await params;
        const pathSegments = slug.path || [];
        const path = pathSegments.join('/');

        const method = request.method;
        let body = null;
        if (method !== 'GET' && method !== 'HEAD') {
            body = await request.arrayBuffer();
        }

        const { search } = new URL(request.url);
        const pathWithSearch = search ? `${path}${search}` : path;

        return await handleProxyRequest(prefix, pathWithSearch, method, request.headers, body, apiKey);
    } catch (error) {
        console.error(`Server proxy failed:`, error);
        throw error;
    }
}

export async function calculateDynamicCost(apiKey, taskName, payload) {
    const response = await fetch(`${FAL_BASE}/api/v1/app/calculate_dynamic_cost`, {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify({ task_name: taskName, payload })
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to calculate dynamic cost: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return await response.json();
}
