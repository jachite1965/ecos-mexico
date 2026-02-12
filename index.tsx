
/* Estilos base estándar que no requieren procesamiento de Tailwind */
:root {
  color-scheme: light dark;
}

body {
  margin: 0;
  padding: 0;
  font-family: 'Inter', sans-serif;
}

h1, h2, h3, h4, .font-serif {
  font-family: 'Cinzel', serif;
}

/* Animaciones suaves */
.fade-in {
  animation: fadeIn 0.6s ease-out forwards;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(15px); }
  to { opacity: 1; transform: translateY(0); }
}

.custom-scroll::-webkit-scrollbar {
  width: 4px;
}
.custom-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scroll::-webkit-scrollbar-thumb {
  background: rgba(185, 28, 28, 0.3);
  border-radius: 10px;
}
