import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const uploadFile = (formData: FormData) => {
  return api.post('/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
};

export const studyText = (data: any) => {
  return api.post('/study', data);
};

export const chatWithText = (data: any) => {
  return api.post('/chat', data);
};

export const generateTTS = (data: any) => {
  return api.post('/tts', data);
};

export const getPageData = (data: any) => {
  return api.post('/pdf/page', data);
};

export const getPageAudio = (data: any) => {
  return api.post('/pdf/page/audio', data);
};

export const getPDFUrl = (filename: string) => {
  return `${API_BASE_URL}/pdf/${filename}`;
};
