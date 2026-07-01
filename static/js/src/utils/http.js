/**
 * HTTP Utility Module
 * Единый HTTP-слой для всех API-запросов
 * Заменяет дублирующиеся паттерны fetch + CSRF-заголовки
 */

import { getCsrfToken } from './csrf.js';

/**
 * Базовая функция запроса
 */
async function request(method, url, body) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    
    const res = await fetch(url, opts);
    
    // 401 — перенаправление на логин
    if (res.status === 401) {
        window.location.href = '/auth/login';
        throw new Error('unauthorized');
    }
    
    // Ошибка ответа
    if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(text || res.statusText);
    }
    
    // Парсим JSON если контент-тип соответствует
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
        return res.json();
    }
    return null;
}

/**
 * GET запрос
 */
export async function httpGet(url) {
    return request('GET', url);
}

/**
 * POST запрос с телом
 */
export async function httpPost(url, body) {
    return request('POST', url, body);
}

/**
 * PUT запрос с телом
 */
export async function httpPut(url, body) {
    return request('PUT', url, body);
}

/**
 * DELETE запрос
 */
export async function httpDelete(url) {
    return request('DELETE', url);
}

/**
 * Экспортируем объект http
 */
export const http = {
    get:  httpGet,
    post: httpPost,
    put:  httpPut,
    del:  httpDelete,
};
