//Сервис для генерации случайных чисел
(function (module) {
    module.service('randomService', function() {
    return {
        //целое в диапазоне
        randomInt: function (min, max) {
            return Math.floor(Math.random() * (max - min + 1)) + min;
        },
        //с плавающей точкой в диапазоне
        randomFloat: function (min, max, digits){
            return (Math.random() * (max - min) + min).toFixed(digits);
        },
        shuffle: function (array) {
            var currentIndex = array.length, temporaryValue, randomIndex;

            // While there remain elements to shuffle...
            while (0 !== currentIndex) {

                // Pick a remaining element...
                randomIndex = Math.floor(Math.random() * currentIndex);
                currentIndex -= 1;

                // And swap it with the current element.
                temporaryValue = array[currentIndex];
                array[currentIndex] = array[randomIndex];
                array[randomIndex] = temporaryValue;
            }

            return array;
        }
    }
});
})(angular.module("fotm"));