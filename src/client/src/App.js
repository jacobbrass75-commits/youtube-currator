import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { checkAuth } from './api';
import Login from './pages/Login';
import Home from './pages/Home';
import Player from './pages/Player';
import Settings from './pages/Settings';
import './App.css';

const BASE = '/yt-curator';

function App() {
  const [auth, setAuth] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    checkAuth()
      .then(data => {
        setAuth(data.authenticated);
        if (data.authenticated) setUser(data.user);
      })
      .catch(() => setAuth(false));
  }, []);

  if (auth === null) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <BrowserRouter basename={BASE}>
      <Routes>
        <Route path="/" element={auth ? <Home user={user} /> : <Login />} />
        <Route path="/watch/:videoId" element={auth ? <Player /> : <Navigate to="/" />} />
        <Route path="/settings" element={auth ? <Settings /> : <Navigate to="/" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
