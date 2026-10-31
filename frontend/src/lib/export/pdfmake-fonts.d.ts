// pdfmake ships its standard-font containers without typings.
declare module "pdfmake/build/standard-fonts/Courier" {
  const container: import("pdfmake/interfaces").TFontContainer;
  export default container;
}
