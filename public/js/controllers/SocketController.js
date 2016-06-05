//Контроллер сокетов
angular.module('fotm').controller("SocketController", ["$scope", '$window', '$location', '$rootScope', '$timeout', '$injector', 'mainSocket', 'chatService', SocketController]);

function SocketController($scope, $window, $location, $rootScope, $timeout, $injector, mainSocket, chatService) {
    $scope.chatOpened = false;
    $scope.newCommonMsg = {
        text: ""
    };
    $scope.newArenaMsg = {
        text: ""
    };
    $scope.chatOpened = false;
    $scope.unreadMsgs = 0;

    if($injector.has('chatService')) {
        $scope.chatService = $injector.get('chatService');
    }

    mainSocket.on("leave", function (serverOnlineUsers) {
        $rootScope.onlineUsers = serverOnlineUsers;
    });

    mainSocket.on("join", function (serverOnlineUsers) {
        $rootScope.onlineUsers = serverOnlineUsers;
    });

    mainSocket.on("connect", function () {

    });

    mainSocket.on("disconnect", function (message) {
        if (message == "io server disconnect") {
            return mainSocket.emit('error', message);
        }
        mainSocket.emit('error');
    });

    mainSocket.on('kicked', function () {
        mainSocket.disconnect();
        $window.location.href="/";
    });

    //Обработка ошибок
    mainSocket.on('connect_error', function () {
        $scope.errorHandler = "disconnected from server";
        mainSocket.disconnect();
    });

    mainSocket.on('connect_timeout', function () {
        $scope.errorHandler = "server timeout is reached";
        mainSocket.disconnect();
    });

    mainSocket.on('error', function (err) {
        $scope.errorHandler = "socket error: " + err;
        mainSocket.disconnect();
    });

    mainSocket.on('customError', function (reason) {
        $scope.errorHandler = "Error: " + JSON.stringify(reason.message);
        mainSocket.disconnect();
    });

    $scope.$on('$destroy', function (event) {
        mainSocket.removeAllListeners();
    });

    //Получение имени игрока от сервера
    $scope.$on('$routeChangeSuccess', function () {
        mainSocket.emit("getUserName");
    });
    mainSocket.on("getUserNameResult", function(name){
        $scope.userName = name;
    });

    mainSocket.on('newMessage', function(msg, channel){
        chatService.newMessage(channel, msg);
        if(!$scope.chatOpened){
            $scope.unreadMsgs++;
        }
    });

    $scope.toggleChat = function() {
        $scope.chatOpened = !$scope.chatOpened;
        if($scope.chatOpened) {
            $scope.unreadMsgs = 0;
        }
    };

    $scope.sendMsg = function(channel){
        //Функция возврщает время в формате hh:mm
        function currentTime() {
            var date = new Date();
            var h = date.getHours();
            var m = date.getMinutes();
            if (h < 10) h = '0' + h;
            if (m < 10) m = '0' + m;
            return h+":"+m;
        }

        function processMsg(msgType){
            if(msgType.text.length<1) return;
            msgType.time = currentTime();
            msgType.sender = $scope.userName;
            mainSocket.emit('sendChatMessage', channel, msgType);
            msgType.text="";
        }

        switch(channel){
            case 'common' : 
                processMsg($scope.newCommonMsg);
                break;
            case 'arena' : 
                processMsg($scope.newArenaMsg);
                break;            
        }
    };

    $scope.addSenderToMsg = function(channel, sender){
        switch(channel) {
            case 'common' :
                $scope.newCommonMsg.text+=sender;
                break;
            case 'arena' :
                $scope.newArenaMsg.text+=sender;
                break;
        }
    };

    //Показ информации
    $rootScope.showInfoMessage = function(message){
        $rootScope.infoMessage=message;
        $timeout(function(){$rootScope.infoMessage=""},4000);
    };

}

angular.module('fotm').factory('mainSocket', function (socketFactory) {
    return socketFactory();
});

//Сервис для чата
angular.module('fotm').service('chatService', ['$filter', function($filter) {
    var commonChat = [];
    var arenaChat = [];
    return {
        newMessage : function (channel, msg) {
            function addMessage(msgArray) {
                msg.text=$filter('linky')(msg.text, '_blank');
                //Очищаем первый элемент чата, если он переполнен
                if (msgArray.length == 100) {
                    msgArray.splice(0, 1);
                }
                msgArray.push(msg);
            }

            switch(channel){
                case 'common' :
                    addMessage(commonChat);
                    break;
                case 'arena' :
                    addMessage(arenaChat);
                    break;
            }
        },
        getMessages : function(channel) {
            switch(channel){
                case 'common' :
                    return commonChat;
                case 'arena' :
                    return arenaChat;
            }
        },
        clearMessages : function(channel) {
            switch(channel){
                case 'common' :
                    commonChat = [];
                case 'arena' :
                    arenaChat = [];
            }
        }
    }
}]);

angular.module('fotm').directive('ngEnter', function() {
    return function(scope, element, attrs) {
        element.bind("keydown", function(e) {
            if(e.which === 13) {
                scope.$apply(function(){
                    scope.$eval(attrs.ngEnter, {'e': e});
                });
                e.preventDefault();
            }
        });
    };
});


