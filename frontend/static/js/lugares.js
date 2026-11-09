/* Lugares para el buscador y los puntos del globo: [nombre, tipo, lat, lon] */
window.NIMBUS_LUGARES = [
  ['Lima', 'Ciudad · Perú', -12.05, -77.04], ['Cusco', 'Ciudad · Perú', -13.53, -71.97], ['Arequipa', 'Ciudad · Perú', -16.4, -71.54],
  ['Trujillo', 'Ciudad · Perú', -8.11, -79.03], ['Piura', 'Ciudad · Perú', -5.19, -80.63], ['Iquitos', 'Ciudad · Perú', -3.75, -73.25],
  ['Puno', 'Ciudad · Perú', -15.84, -70.02], ['Chiclayo', 'Ciudad · Perú', -6.77, -79.84], ['Huancayo', 'Ciudad · Perú', -12.07, -75.2],

  ['Tumbes', 'Departamento · Perú', -3.57, -80.45], ['Lambayeque', 'Departamento · Perú', -6.7, -79.9], ['Cajamarca', 'Departamento · Perú', -7.16, -78.5],
  ['Amazonas', 'Departamento · Perú', -6.23, -77.87], ['Loreto', 'Departamento · Perú', -3.75, -73.25], ['San Martín', 'Departamento · Perú', -6.03, -76.97],
  ['La Libertad', 'Departamento · Perú', -8.11, -79.03], ['Áncash', 'Departamento · Perú', -9.53, -77.53], ['Huánuco', 'Departamento · Perú', -9.93, -76.24],
  ['Ucayali', 'Departamento · Perú', -8.38, -74.55], ['Pasco', 'Departamento · Perú', -10.68, -76.26], ['Callao', 'Provincia Constitucional · Perú', -12.05, -77.12],
  ['Junín', 'Departamento · Perú', -12.07, -75.2], ['Huancavelica', 'Departamento · Perú', -12.79, -74.97], ['Ica', 'Departamento · Perú', -14.07, -75.73],
  ['Ayacucho', 'Departamento · Perú', -13.16, -74.22], ['Apurímac', 'Departamento · Perú', -13.64, -72.88], ['Madre de Dios', 'Departamento · Perú', -12.59, -69.19],
  ['Moquegua', 'Departamento · Perú', -17.19, -70.94], ['Tacna', 'Departamento · Perú', -18.01, -70.25],

  ['Miraflores', 'Distrito · Lima', -12.12, -77.03], ['Barranco', 'Distrito · Lima', -12.15, -77.02], ['San Isidro', 'Distrito · Lima', -12.1, -77.04],
  ['Yanahuara', 'Distrito · Arequipa', -16.39, -71.54], ['Chivay', 'Distrito · Caylloma, Arequipa', -15.64, -71.6], ['Cabanaconde', 'Distrito · Caylloma, Arequipa', -15.62, -71.97],

  ['Bogotá', 'Ciudad · Colombia', 4.71, -74.07], ['Quito', 'Ciudad · Ecuador', -0.18, -78.47], ['Caracas', 'Ciudad · Venezuela', 10.48, -66.9],
  ['La Paz', 'Ciudad · Bolivia', -16.5, -68.15], ['Santiago', 'Ciudad · Chile', -33.45, -70.67], ['Buenos Aires', 'Ciudad · Argentina', -34.6, -58.38],
  ['Montevideo', 'Ciudad · Uruguay', -34.9, -56.16], ['Asunción', 'Ciudad · Paraguay', -25.26, -57.58], ['São Paulo', 'Ciudad · Brasil', -23.55, -46.63],
  ['Río de Janeiro', 'Ciudad · Brasil', -22.9, -43.2], ['Manaos', 'Ciudad · Brasil', -3.1, -60.02], ['Ciudad de México', 'Ciudad · México', 19.43, -99.13],
  ['Ciudad de Panamá', 'Ciudad · Panamá', 8.98, -79.52], ['La Habana', 'Ciudad · Cuba', 23.11, -82.37], ['Miami', 'Ciudad · EE. UU.', 25.76, -80.19],
  ['Nueva York', 'Ciudad · EE. UU.', 40.71, -74.0], ['Los Ángeles', 'Ciudad · EE. UU.', 34.05, -118.24], ['Toronto', 'Ciudad · Canadá', 43.65, -79.38],
  ['Madrid', 'Ciudad · España', 40.42, -3.7], ['Lisboa', 'Ciudad · Portugal', 38.72, -9.14], ['Dakar', 'Ciudad · Senegal', 14.72, -17.47],
  ['Lagos', 'Ciudad · Nigeria', 6.52, 3.38], ['Ciudad del Cabo', 'Ciudad · Sudáfrica', -33.92, 18.42],
].map(([n, t, lat, lon]) => ({ n, t, lat, lon }));
